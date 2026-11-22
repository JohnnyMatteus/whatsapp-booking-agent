"""Laço de decisão de uma entrega: processa, confirma, ou reencaminha para retry/DLQ antes do ack.

Reencaminhar antes do ack significa que uma queda entre os dois reentrega a mensagem, nunca a perde.
Fica separado do aio-pika por protocolos para ser testado sem broker.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .contracts import ContractViolation
from .retry_policy import ATTEMPT_HEADER, DeadLetter, decide_on_failure
from .topology import dead_letter_queue_of, retry_queue_of

logger = logging.getLogger(__name__)


class Delivery(Protocol):
    body: bytes
    headers: Mapping[str, Any]
    content_type: str | None
    message_id: str | None
    correlation_id: str | None

    async def ack(self) -> None: ...

    async def nack_requeue(self) -> None: ...


class Forwarder(Protocol):
    async def forward(self, queue: str, delivery: Delivery, headers: dict[str, Any]) -> None:
        """Publica o corpo da entrega na fila indicada, com confirmação do broker."""


class Observer(Protocol):
    def consumed(self, queue: str, result: str) -> None: ...

    def handled(self, outcome: str, seconds: float) -> None: ...


@dataclass(frozen=True)
class ConsumerOptions:
    queue: str
    max_attempts: int


async def handle_delivery(
    delivery: Delivery,
    process: Callable[[dict[str, Any]], str],
    forwarder: Forwarder,
    observer: Observer,
    options: ConsumerOptions,
    clock: Callable[[], float],
) -> None:
    attempt = _attempt_of(delivery.headers)
    started = clock()
    try:
        envelope = _parse(delivery.body)
        outcome = await asyncio.to_thread(process, envelope)
    except Exception as error:
        decision = decide_on_failure(error, attempt, options.max_attempts)
        if isinstance(decision, DeadLetter):
            target = dead_letter_queue_of(options.queue)
            headers = {**delivery.headers, "x-failure-reason": decision.reason, "x-error": type(error).__name__}
            result = "dead_letter"
        else:
            target = retry_queue_of(options.queue)
            headers = {**delivery.headers, ATTEMPT_HEADER: decision.next_attempt}
            result = "retry"
        try:
            await forwarder.forward(target, delivery, headers)
        except Exception:
            logger.exception("forward_failed")
            await delivery.nack_requeue()
            return
        await delivery.ack()
        # Só o tipo do erro vai para o log: a mensagem pode ecoar corpo de resposta do gateway.
        logger.warning("media_%s", result, extra={"attempt": attempt, "error": type(error).__name__})
        observer.consumed(options.queue, result)
        return
    await delivery.ack()
    observer.consumed(options.queue, "ack")
    observer.handled(outcome, clock() - started)


def _parse(body: bytes) -> dict[str, Any]:
    try:
        envelope = json.loads(body)
    except ValueError:
        raise ContractViolation("corpo não é JSON") from None
    if not isinstance(envelope, dict):
        raise ContractViolation("corpo não é um objeto JSON")
    return envelope


def _attempt_of(headers: Mapping[str, Any]) -> int:
    value = headers.get(ATTEMPT_HEADER, 1)
    return value if isinstance(value, int) and value >= 1 else 1
