"""Espelho mínimo da linguagem publicada (@wba/contracts) para as mensagens que o serviço usa."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from .domain import MediaKind, MediaToProcess, RejectionReason

CONTRACT_VERSION = 1
MEDIA_RECEIVED = "inbound.media_received"
MESSAGE_RECEIVED = "inbound.message_received"
MEDIA_PROCESSED = "media.processed"
MAX_TEXT = 4096


class ContractViolation(Exception):
    """Mensagem fora do contrato: vai para a DLQ sem retry."""


def parse_media_received(envelope: dict[str, Any]) -> tuple[MediaToProcess, str]:
    if envelope.get("version") != CONTRACT_VERSION or envelope.get("type") != MEDIA_RECEIVED:
        raise ContractViolation("esperado inbound.media_received v1")
    payload = envelope.get("payload")
    correlation_id = envelope.get("correlationId")
    if not isinstance(payload, dict) or not isinstance(correlation_id, str):
        raise ContractViolation("payload ou correlationId ausente")
    try:
        media = MediaToProcess(
            tenant_id=_str(payload, "tenantId"),
            contact_id=_str(payload, "contactId"),
            message_id=_str(payload, "messageId"),
            received_at=_str(payload, "receivedAt"),
            kind=MediaKind(_str(payload, "kind")),
            media_id=_str(payload, "mediaId"),
            mime_type=_str(payload, "mimeType"),
        )
    except KeyError as missing:
        raise ContractViolation(f"campo ausente ou vazio: {missing}") from None
    except ValueError:
        raise ContractViolation("kind fora de audio e image") from None
    return media, correlation_id


def _envelope(type_: str, payload: dict[str, Any], correlation_id: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "type": type_,
        "version": CONTRACT_VERSION,
        "occurredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "correlationId": correlation_id,
        "payload": payload,
    }


def _origin(media: MediaToProcess) -> dict[str, Any]:
    return {
        "tenantId": media.tenant_id,
        "contactId": media.contact_id,
        "messageId": media.message_id,
        "receivedAt": media.received_at,
    }


def message_received(media: MediaToProcess, content: dict[str, Any], correlation_id: str) -> dict[str, Any]:
    """Mesmo messageId da mídia: para o agente, é a mesma mensagem do aluno, agora em texto."""
    return _envelope(MESSAGE_RECEIVED, {**_origin(media), "content": content}, correlation_id)


def media_processed(
    media: MediaToProcess,
    correlation_id: str,
    *,
    size_bytes: int | None = None,
    storage_key: str | None = None,
    thumbnail_key: str | None = None,
    transcribed: bool = False,
    rejection: RejectionReason | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        **_origin(media),
        "kind": media.kind.value,
        "status": "rejected" if rejection else "processed",
        "mimeType": media.mime_type[:128],
        "transcribed": transcribed,
    }
    optional = {
        "sizeBytes": size_bytes,
        "storageKey": storage_key,
        "thumbnailKey": thumbnail_key,
        "rejectionReason": rejection.value if rejection else None,
    }
    payload.update({k: v for k, v in optional.items() if v is not None})
    return _envelope(MEDIA_PROCESSED, payload, correlation_id)


def text_content(text: str) -> dict[str, Any]:
    return {"kind": "text", "text": text[:MAX_TEXT], "transcribed": True}


def unsupported_content(description: str) -> dict[str, Any]:
    return {"kind": "unsupported", "description": description[:64]}


def _str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or value == "":
        raise KeyError(key)
    return value
