"""Composição do serviço (esqueleto): consome inbound.media_received e publica os eventos.

O consumo usa a mesma topologia do RabbitMQ dos serviços Node (fila quorum, retry e DLQ).
Nesta fundação o laço de consumo é mínimo; retry com TTL e métricas completas estão em
Próximos passos no README.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from .contracts import ContractViolation
from .service import ProcessMedia

EXCHANGE = "wba.events"
QUEUE = "media-processor.media"


def build_service() -> ProcessMedia:
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
        publisher=_LazyPublisher(),
    )


class _LazyPublisher:
    """Preenchido com o canal do aio-pika quando o consumidor conecta."""

    channel: Any = None
    loop: asyncio.AbstractEventLoop | None = None

    def publish(self, envelope: dict[str, Any]) -> None:
        import aio_pika

        message = aio_pika.Message(
            json.dumps(envelope).encode(),
            content_type="application/json",
            message_id=envelope["id"],
            correlation_id=envelope["correlationId"],
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        assert self.loop is not None
        exchange = asyncio.run_coroutine_threadsafe(self.channel.get_exchange(EXCHANGE), self.loop).result()
        asyncio.run_coroutine_threadsafe(exchange.publish(message, routing_key=envelope["type"]), self.loop).result()


async def consume() -> None:
    import aio_pika

    service = build_service()
    publisher = service._publisher
    assert isinstance(publisher, _LazyPublisher)
    connection = await aio_pika.connect_robust(os.environ["RABBITMQ_URL"])
    channel = await connection.channel(publisher_confirms=True)
    publisher.channel, publisher.loop = channel, asyncio.get_running_loop()
    await channel.set_qos(prefetch_count=1)
    exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
    queue = await channel.declare_queue(QUEUE, durable=True, arguments={"x-queue-type": "quorum"})
    await queue.bind(exchange, routing_key="inbound.media_received")

    async with queue.iterator() as messages:
        async for message in messages:
            try:
                outcome = await asyncio.to_thread(service.handle, json.loads(message.body))
                await message.ack()
                logging.info("media_handled", extra={"outcome": outcome})
            except ContractViolation:
                await message.reject(requeue=False)
            except Exception:
                logging.exception("media_failed")
                await message.nack(requeue=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":"%(message)s"}')
    asyncio.run(consume())
