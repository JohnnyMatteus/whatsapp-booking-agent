from __future__ import annotations

import json
from typing import Any

import pytest
from prometheus_client import CollectorRegistry

from media_processor.consumer import ConsumerOptions, handle_delivery
from media_processor.contracts import ContractViolation
from media_processor.metrics import PrometheusObserver
from media_processor.retry_policy import DeadLetter, Retry, decide_on_failure
from media_processor.topology import QUEUE, dead_letter_queue_of, queue_arguments, retry_queue_of

OPTIONS = ConsumerOptions(queue=QUEUE, max_attempts=3)


class FakeDelivery:
    def __init__(self, body: bytes, headers: dict[str, Any] | None = None) -> None:
        self.body = body
        self.headers = headers or {}
        self.content_type: str | None = "application/json"
        self.message_id: str | None = "m1"
        self.correlation_id: str | None = "c1"
        self.events: list[str] = []

    async def ack(self) -> None:
        self.events.append("ack")

    async def nack_requeue(self) -> None:
        self.events.append("nack_requeue")


class FakeForwarder:
    def __init__(self, delivery: FakeDelivery, fail: bool = False) -> None:
        self.forwarded: list[tuple[str, dict[str, Any]]] = []
        self._delivery, self._fail = delivery, fail

    async def forward(self, queue: str, delivery: Any, headers: dict[str, Any]) -> None:
        if self._fail:
            raise ConnectionError("broker fora")
        self._delivery.events.append("forward")
        self.forwarded.append((queue, headers))


class Recorder:
    def __init__(self) -> None:
        self.consumed_results: list[str] = []
        self.outcomes: list[str] = []

    def consumed(self, queue: str, result: str) -> None:
        self.consumed_results.append(result)

    def handled(self, outcome: str, seconds: float) -> None:
        self.outcomes.append(outcome)


def body() -> bytes:
    return json.dumps({"any": "envelope"}).encode()


async def run(
    delivery: FakeDelivery, process: Any, forwarder: FakeForwarder | None = None
) -> tuple[FakeForwarder, Recorder]:
    forwarder = forwarder or FakeForwarder(delivery)
    observer = Recorder()
    await handle_delivery(delivery, process, forwarder, observer, OPTIONS, lambda: 0.0)
    return forwarder, observer


async def test_sucesso_confirma_e_registra_o_desfecho() -> None:
    delivery = FakeDelivery(body())

    forwarder, observer = await run(delivery, lambda _: "transcribed")

    assert delivery.events == ["ack"]
    assert forwarder.forwarded == []
    assert observer.consumed_results == ["ack"] and observer.outcomes == ["transcribed"]


async def test_falha_transitoria_vai_para_a_fila_de_retry_com_a_proxima_tentativa_antes_do_ack() -> None:
    delivery = FakeDelivery(body(), {"x-attempt": 2})

    def boom(_: dict[str, Any]) -> str:
        raise ConnectionError("gateway 502")

    forwarder, observer = await run(delivery, boom)

    assert delivery.events == ["forward", "ack"]
    assert forwarder.forwarded == [(retry_queue_of(QUEUE), {"x-attempt": 3})]
    assert observer.consumed_results == ["retry"]


async def test_esgotadas_as_tentativas_vai_para_a_dlq_com_o_motivo_sem_a_mensagem_do_erro() -> None:
    delivery = FakeDelivery(body(), {"x-attempt": 3})

    def boom(_: dict[str, Any]) -> str:
        raise ConnectionError("corpo da resposta com dado pessoal")

    forwarder, observer = await run(delivery, boom)

    [(queue, headers)] = forwarder.forwarded
    assert queue == dead_letter_queue_of(QUEUE)
    assert headers["x-failure-reason"] == "max_attempts" and headers["x-error"] == "ConnectionError"
    assert "dado pessoal" not in json.dumps(headers)
    assert observer.consumed_results == ["dead_letter"]


@pytest.mark.parametrize("raw", [b"nao e json", b"[1, 2]"])
async def test_corpo_fora_do_contrato_vai_direto_para_a_dlq(raw: bytes) -> None:
    delivery = FakeDelivery(raw)

    forwarder, _ = await run(delivery, lambda _: "nunca")

    assert [q for q, _ in forwarder.forwarded] == [dead_letter_queue_of(QUEUE)]
    assert forwarder.forwarded[0][1]["x-failure-reason"] == "ContractViolation"


async def test_se_o_reencaminhamento_falha_a_mensagem_volta_para_a_fila_e_nao_e_confirmada() -> None:
    delivery = FakeDelivery(body())

    def boom(_: dict[str, Any]) -> str:
        raise ConnectionError("x")

    await run(delivery, boom, FakeForwarder(delivery, fail=True))

    assert delivery.events == ["nack_requeue"]


def test_politica_de_falha() -> None:
    assert decide_on_failure(ContractViolation("x"), 1, 4) == DeadLetter("ContractViolation")
    assert decide_on_failure(RuntimeError("x"), 1, 4) == Retry(2)
    assert decide_on_failure(RuntimeError("x"), 4, 4) == DeadLetter("max_attempts")


def test_topologia_repete_os_argumentos_do_declare_queue_dos_servicos_node() -> None:
    args = queue_arguments(QUEUE, 3000)

    assert args[QUEUE] == {"x-queue-type": "quorum"}
    assert args[dead_letter_queue_of(QUEUE)] == {"x-queue-type": "quorum"}
    assert args[retry_queue_of(QUEUE)] == {
        "x-queue-type": "quorum",
        "x-message-ttl": 3000,
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": QUEUE,
    }


def test_metricas_usam_os_nomes_dos_alertas_existentes() -> None:
    registry = CollectorRegistry()
    observer = PrometheusObserver(registry)

    observer.consumed(QUEUE, "dead_letter")
    observer.handled("rejected", 0.2)

    assert registry.get_sample_value("wba_queue_messages_total", {"queue": QUEUE, "result": "dead_letter"}) == 1
    assert registry.get_sample_value("wba_media_processed_total", {"outcome": "rejected"}) == 1


async def test_consumo_que_morre_sozinho_encerra_com_erro_para_o_restart_agir() -> None:
    import asyncio

    from media_processor.consumer import run_until_stopped

    async def drain_quebrado() -> None:
        raise ConnectionError("canal fechado")

    async def drain_encerrado() -> None:
        return None

    assert await asyncio.wait_for(run_until_stopped(drain_quebrado(), asyncio.Event()), 1) == 1
    assert await asyncio.wait_for(run_until_stopped(drain_encerrado(), asyncio.Event()), 1) == 1


async def test_pedido_de_parada_encerra_limpo_e_cancela_o_consumo() -> None:
    import asyncio

    from media_processor.consumer import run_until_stopped

    cancelled = asyncio.Event()

    async def drain_infinito() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    stop = asyncio.Event()
    stop.set()

    assert await asyncio.wait_for(run_until_stopped(drain_infinito(), stop), 1) == 0
    assert cancelled.is_set()
