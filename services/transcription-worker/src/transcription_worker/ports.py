"""Portas do worker. Adaptadores reais e falsos implementam estes protocolos."""

from __future__ import annotations

from typing import Any, Protocol

from .domain import Transcript


class MediaSource(Protocol):
    """Baixa a mídia do WhatsApp pelo id (Cloud API em produção, WireMock em desenvolvimento)."""

    def fetch(self, media_id: str) -> bytes: ...


class MediaStore(Protocol):
    """Guarda o áudio original (S3, MinIO ou LocalStack, com endpoint configurável)."""

    def put(self, key: str, data: bytes, content_type: str) -> None: ...


class Transcriber(Protocol):
    """Transcreve localmente: o áudio do aluno não vai para API de terceiros."""

    def transcribe(self, audio: bytes, mime_type: str) -> Transcript: ...


class Publisher(Protocol):
    def publish(self, envelope: dict[str, Any]) -> None: ...
