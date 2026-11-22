"""Portas do serviço. Adaptadores reais e falsos implementam estes protocolos."""

from __future__ import annotations

from typing import Any, Protocol

from .domain import Transcript


class MediaSource(Protocol):
    """Obtém os bytes da mídia pelo messaging-gateway, que esconde qual provedor o estúdio usa.

    Levanta MediaRejected(TOO_LARGE) se passar de max_bytes e MediaRejected(UNAVAILABLE) se expirou.
    """

    def fetch(self, tenant_id: str, media_id: str, max_bytes: int) -> bytes: ...


class MediaStore(Protocol):
    """Guarda o original e a miniatura (S3, MinIO ou LocalStack, com endpoint configurável)."""

    def put(self, key: str, data: bytes, content_type: str) -> None: ...


class Transcriber(Protocol):
    """Transcreve localmente: o áudio do aluno não vai para API de terceiros."""

    def transcribe(self, audio: bytes, mime_type: str) -> Transcript: ...


class ThumbnailGenerator(Protocol):
    """Gera a miniatura JPEG. Levanta MediaRejected(CORRUPT) se a imagem não decodifica."""

    def generate(self, image: bytes) -> bytes: ...


class Publisher(Protocol):
    def publish(self, envelope: dict[str, Any]) -> None: ...
