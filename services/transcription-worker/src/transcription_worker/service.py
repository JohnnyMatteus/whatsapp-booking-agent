"""Caso de uso: áudio recebido → armazenado → transcrito localmente → texto publicado para o agente."""

from __future__ import annotations

import logging
from typing import Any

from . import contracts
from .domain import MAX_AUDIO_BYTES, TranscriptionRejected
from .ports import MediaSource, MediaStore, Publisher, Transcriber

logger = logging.getLogger(__name__)


class TranscribeAudio:
    def __init__(self, media: MediaSource, store: MediaStore, transcriber: Transcriber, publisher: Publisher) -> None:
        self._media = media
        self._store = store
        self._transcriber = transcriber
        self._publisher = publisher

    def handle(self, envelope: dict[str, Any]) -> str:
        """Devolve o desfecho (para métricas): transcribed, empty ou rejected."""
        audio, correlation_id = contracts.parse_audio_received(envelope)
        try:
            audio.check_format()
            data = self._media.fetch(audio.media_id)
            if len(data) > MAX_AUDIO_BYTES:
                raise TranscriptionRejected("áudio acima do limite")
        except TranscriptionRejected as rejected:
            # O aluno recebe a orientação de mídia sem suporte em vez de silêncio.
            logger.info("audio_rejected", extra={"correlation_id": correlation_id, "reason": rejected.reason})
            self._publisher.publish(
                contracts.message_received(audio, contracts.unsupported_content("audio_rejected"), correlation_id)
            )
            return "rejected"

        key = f"audio/{audio.tenant_id}/{audio.received_at[:10]}/{audio.media_id}"
        self._store.put(key, data, audio.mime_type)

        transcript = self._transcriber.transcribe(data, audio.mime_type)
        if transcript.is_empty():
            self._publisher.publish(
                contracts.message_received(audio, contracts.unsupported_content("empty_audio"), correlation_id)
            )
            return "empty"

        self._publisher.publish(
            contracts.message_received(audio, contracts.text_content(transcript.text.strip()), correlation_id)
        )
        logger.info(
            "audio_transcribed",
            extra={"correlation_id": correlation_id, "duration_seconds": transcript.duration_seconds},
        )
        return "transcribed"
