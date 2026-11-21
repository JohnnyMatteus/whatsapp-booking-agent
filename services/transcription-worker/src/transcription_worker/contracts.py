"""Espelho mínimo da linguagem publicada (@wba/contracts) para as mensagens que o worker usa."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from .domain import AudioToTranscribe

CONTRACT_VERSION = 1
AUDIO_RECEIVED = "inbound.audio_received"
MESSAGE_RECEIVED = "inbound.message_received"
MAX_TEXT = 4096


class ContractViolation(Exception):
    """Mensagem fora do contrato: vai para a DLQ sem retry."""


def parse_audio_received(envelope: dict[str, Any]) -> tuple[AudioToTranscribe, str]:
    if envelope.get("version") != CONTRACT_VERSION or envelope.get("type") != AUDIO_RECEIVED:
        raise ContractViolation("esperado inbound.audio_received v1")
    payload = envelope.get("payload")
    correlation_id = envelope.get("correlationId")
    if not isinstance(payload, dict) or not isinstance(correlation_id, str):
        raise ContractViolation("payload ou correlationId ausente")
    try:
        audio = AudioToTranscribe(
            tenant_id=_str(payload, "tenantId"),
            contact_id=_str(payload, "contactId"),
            message_id=_str(payload, "messageId"),
            received_at=_str(payload, "receivedAt"),
            media_id=_str(payload, "mediaId"),
            mime_type=_str(payload, "mimeType"),
        )
    except KeyError as missing:
        raise ContractViolation(f"campo ausente ou vazio: {missing}") from None
    return audio, correlation_id


def message_received(audio: AudioToTranscribe, content: dict[str, Any], correlation_id: str) -> dict[str, Any]:
    """Mesmo messageId do áudio: para o agente, é a mesma mensagem do aluno, agora em texto."""
    return {
        "id": str(uuid.uuid4()),
        "type": MESSAGE_RECEIVED,
        "version": CONTRACT_VERSION,
        "occurredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "correlationId": correlation_id,
        "payload": {
            "tenantId": audio.tenant_id,
            "contactId": audio.contact_id,
            "messageId": audio.message_id,
            "receivedAt": audio.received_at,
            "content": content,
        },
    }


def text_content(text: str) -> dict[str, Any]:
    return {"kind": "text", "text": text[:MAX_TEXT], "transcribed": True}


def unsupported_content(description: str) -> dict[str, Any]:
    return {"kind": "unsupported", "description": description[:64]}


def _str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or value == "":
        raise KeyError(key)
    return value
