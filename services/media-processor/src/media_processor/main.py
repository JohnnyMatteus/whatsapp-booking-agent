"""Composição do serviço: consome inbound.media_received, processa e publica os eventos.

Mesma topologia do RabbitMQ dos serviços Node (ADR 0006): fila quorum, retry com TTL e DLQ.
A decisão de cada entrega está em `consumer.py`; aqui ficam só os adaptadores do aio-pika.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from collections.abc import Mapping
from typing import Any

from .consumer import ConsumerOptions, Delivery, handle_delivery
from .service import ProcessMedia
from .topology import BINDINGS, EXCHANGE, QUEUE, queue_arguments


def build_service(publisher: Any) -> ProcessMedia:
    from .adapters.fake import FakeTranscriber
    from .adapters.gateway_media import GatewayMediaSource
    from .adapters.pillow_thumbnail import PillowThumbnailGenerator
    from .adapters.s3_store import S3MediaStore

    if os.environ.get("TRANSCRIBER", "fake") == "faster-whisper":
        from .adapters.faster_whisper import FasterWhisperTranscriber

        transcriber: Any = FasterWhisperTranscriber(model_size=os.environ.get("WHISPER_MODEL", "small"))
    else:
        transcriber = FakeTranscriber()

    return ProcessMedia(
        media=GatewayMediaSource(os.environ["GATEWAY_URL"], os.environ["MEDIA_API_TOKEN"]),
        store=S3MediaStore(os.environ["MEDIA_BUCKET"], os.environ.get("S3_ENDPOINT_URL")),
        transcriber=transcriber,
        thumbnails=PillowThumbnailGenerator(),
        publisher=publisher,
    )


class AioPikaPublisher:
    """Porta `Publisher` síncrona (o caso de uso roda em thread) sobre o canal assíncrono, com confirmação."""

    def __init__(self, channel: Any, loop: asyncio.AbstractEventLoop) -> None:
        self._channel, self._loop = channel, loop

    def publish(self, envelope: dict[str, Any]) -> None:
        import aio_pika

        message = aio_pika.Message(
            json.dumps(envelope).encode(),
            content_type="application/json",
            message_id=envelope["id"],
            correlation_id=envelope["correlationId"],
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )

        async def send() -> None:
            exchange = await self._channel.get_exchange(EXCHANGE)
            await exchange.publish(message, routing_key=envelope["type"])

        asyncio.run_coroutine_threadsafe(send(), self._loop).result(timeout=30)


class _Delivery:
    def __init__(self, message: Any) -> None:
        self._message = message
        self.body: bytes = message.body
        self.headers: Mapping[str, Any] = dict(message.headers or {})
        self.content_type: str | None = message.content_type
        self.message_id: str | None = message.message_id
        self.correlation_id: str | None = message.correlation_id

    async def ack(self) -> None:
        await self._message.ack()

    async def nack_requeue(self) -> None:
        await self._message.nack(requeue=True)


class _Forwarder:
    def __init__(self, channel: Any) -> None:
        self._channel = channel

    async def forward(self, queue: str, delivery: Delivery, headers: dict[str, Any]) -> None:
        import aio_pika

        message = aio_pika.Message(
            delivery.body,
            headers=headers,
            content_type=delivery.content_type,
            message_id=delivery.message_id,
            correlation_id=delivery.correlation_id,
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        # Exchange padrão: a routing key é o nome da fila. O canal tem publisher confirms.
        await self._channel.default_exchange.publish(message, routing_key=queue)


async def consume() -> None:
    import aio_pika
    from prometheus_client import REGISTRY, start_http_server

    from .metrics import PrometheusObserver

    max_attempts = int(os.environ.get("CONSUMER_MAX_ATTEMPTS", "4"))
    retry_delay_ms = int(os.environ.get("CONSUMER_RETRY_DELAY_MS", "3000"))
    start_http_server(int(os.environ.get("PORT", "8083")), registry=REGISTRY)
    observer = PrometheusObserver(REGISTRY)

    connection = await aio_pika.connect_robust(os.environ["RABBITMQ_URL"])
    channel = await connection.channel(publisher_confirms=True)
    await channel.set_qos(prefetch_count=1)
    exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
    queues: dict[str, Any] = {}
    for name, arguments in queue_arguments(QUEUE, retry_delay_ms).items():
        queues[name] = await channel.declare_queue(name, durable=True, arguments=arguments)
    for routing_key in BINDINGS:
        await queues[QUEUE].bind(exchange, routing_key=routing_key)

    service = build_service(AioPikaPublisher(channel, asyncio.get_running_loop()))
    options = ConsumerOptions(queue=QUEUE, max_attempts=max_attempts)
    forwarder = _Forwarder(channel)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    async with queues[QUEUE].iterator() as messages:
        logging.info("media_consuming")

        async def drain() -> None:
            async for message in messages:
                await handle_delivery(_Delivery(message), service.handle, forwarder, observer, options, time.monotonic)

        task = asyncio.create_task(drain())
        await stop.wait()
        task.cancel()
    await connection.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":"%(message)s"}')
    asyncio.run(consume())
