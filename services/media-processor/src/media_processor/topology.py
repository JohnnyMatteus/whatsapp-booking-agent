"""Topologia da fila de mídia: igual à dos serviços Node (`packages/contracts/src/topology.ts`)."""

from __future__ import annotations

from typing import Any

EXCHANGE = "wba.events"
QUEUE = "media-processor.media"
BINDINGS = ("inbound.media_received",)

_QUORUM: dict[str, Any] = {"x-queue-type": "quorum"}


def retry_queue_of(queue: str) -> str:
    return f"{queue}.retry"


def dead_letter_queue_of(queue: str) -> str:
    return f"{queue}.dlq"


def queue_arguments(queue: str, retry_delay_ms: int) -> dict[str, dict[str, Any]]:
    """Argumentos de cada fila declarada. Precisam ser idênticos aos do `declareQueue` do `@wba/messaging`,
    senão o RabbitMQ recusa a redeclaração (PRECONDITION_FAILED)."""
    return {
        queue: dict(_QUORUM),
        dead_letter_queue_of(queue): dict(_QUORUM),
        retry_queue_of(queue): {
            **_QUORUM,
            "x-message-ttl": retry_delay_ms,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": queue,
        },
    }
