"""Caso de uso: mídia recebida → validada → guardada → (miniatura | transcrição) → eventos publicados."""

from __future__ import annotations

import logging
from typing import Any

from . import contracts
from .domain import MediaKind, MediaRejected, MediaToProcess, RejectionReason, validate
from .ports import MediaSource, MediaStore, Publisher, ThumbnailGenerator, Transcriber

logger = logging.getLogger(__name__)

THUMBNAIL_CONTENT_TYPE = "image/jpeg"


class ProcessMedia:
    def __init__(
        self,
        media: MediaSource,
        store: MediaStore,
        transcriber: Transcriber,
        thumbnails: ThumbnailGenerator,
        publisher: Publisher,
    ) -> None:
        self._media = media
        self.store = store
        self._transcriber = transcriber
        self._thumbnails = thumbnails
        self._publisher = publisher

    def handle(self, envelope: dict[str, Any]) -> str:
        """Devolve o desfecho (para métricas): transcribed, empty, stored ou rejected."""
        media, correlation_id = contracts.parse_media_received(envelope)
        try:
            media.check_declared_type()
            data = self._media.fetch(media.tenant_id, media.media_id, media.kind.max_bytes)
            validate(media, data)
            return self._process(media, data, correlation_id)
        except MediaRejected as rejected:
            return self._reject(media, rejected.reason, correlation_id)

    def _process(self, media: MediaToProcess, data: bytes, correlation_id: str) -> str:
        key = media.storage_key()
        thumbnail_key: str | None = None
        if media.kind is MediaKind.IMAGE:
            # Gera antes de guardar: imagem que não decodifica não deve ficar no armazenamento.
            thumbnail = self._thumbnails.generate(data)
            thumbnail_key = f"{key}.thumb.jpg"
            self.store.put(thumbnail_key, thumbnail, THUMBNAIL_CONTENT_TYPE)
        self.store.put(key, data, media.mime_type)

        if media.kind is MediaKind.IMAGE:
            self._publisher.publish(
                contracts.media_processed(
                    media, correlation_id, size_bytes=len(data), storage_key=key, thumbnail_key=thumbnail_key
                )
            )
            # O agente não interpreta imagem: o aluno recebe a orientação de mídia sem suporte, não silêncio.
            self._publisher.publish(
                contracts.message_received(media, contracts.unsupported_content("image"), correlation_id)
            )
            logger.info("image_stored", extra={"correlation_id": correlation_id})
            return "stored"

        transcript = self._transcriber.transcribe(data, media.mime_type)
        empty = transcript.is_empty()
        self._publisher.publish(
            contracts.media_processed(
                media, correlation_id, size_bytes=len(data), storage_key=key, transcribed=not empty
            )
        )
        content = (
            contracts.unsupported_content("empty_audio") if empty else contracts.text_content(transcript.text.strip())
        )
        self._publisher.publish(contracts.message_received(media, content, correlation_id))
        logger.info(
            "audio_handled",
            extra={"correlation_id": correlation_id, "duration_seconds": transcript.duration_seconds, "empty": empty},
        )
        return "empty" if empty else "transcribed"

    def _reject(self, media: MediaToProcess, reason: RejectionReason, correlation_id: str) -> str:
        logger.info("media_rejected", extra={"correlation_id": correlation_id, "reason": reason.value})
        self._publisher.publish(contracts.media_processed(media, correlation_id, rejection=reason))
        # O aluno recebe a orientação de mídia sem suporte em vez de silêncio.
        description = f"{media.kind.value}_rejected"
        self._publisher.publish(
            contracts.message_received(media, contracts.unsupported_content(description), correlation_id)
        )
        return "rejected"
