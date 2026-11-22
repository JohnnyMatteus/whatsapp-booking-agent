"""Modelo do serviço: a mídia a processar, as regras de validação e o resultado. Sem dependências externas."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

# 16 MB é o limite de áudio do WhatsApp; 5 MB, o de imagem.
MAX_AUDIO_BYTES = 16 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class MediaKind(StrEnum):
    AUDIO = "audio"
    IMAGE = "image"

    @property
    def max_bytes(self) -> int:
        return MAX_AUDIO_BYTES if self is MediaKind.AUDIO else MAX_IMAGE_BYTES


class RejectionReason(StrEnum):
    UNSUPPORTED_TYPE = "unsupported_type"
    TOO_LARGE = "too_large"
    TYPE_MISMATCH = "type_mismatch"
    CORRUPT = "corrupt"
    UNAVAILABLE = "unavailable"


class MediaRejected(Exception):
    """Mídia que não deve ser processada. Não adianta tentar de novo."""

    def __init__(self, reason: RejectionReason) -> None:
        super().__init__(reason.value)
        self.reason = reason


ALLOWED_MIME_PREFIXES: dict[MediaKind, tuple[str, ...]] = {
    MediaKind.AUDIO: ("audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"),
    MediaKind.IMAGE: ("image/jpeg", "image/png", "image/webp"),
}

_SAFE_KEY = re.compile(r"[^A-Za-z0-9._-]")


@dataclass(frozen=True)
class MediaToProcess:
    tenant_id: str
    contact_id: str
    message_id: str
    received_at: str
    kind: MediaKind
    media_id: str
    mime_type: str

    def check_declared_type(self) -> None:
        if not self.mime_type.lower().startswith(ALLOWED_MIME_PREFIXES[self.kind]):
            raise MediaRejected(RejectionReason.UNSUPPORTED_TYPE)

    def storage_key(self) -> str:
        """Prefixo por estúdio e dia: a expiração de 30 dias e a exclusão por estúdio ficam simples."""
        return f"media/{self.tenant_id}/{self.received_at[:10]}/{_SAFE_KEY.sub('_', self.media_id)}"


def sniff_kind(data: bytes) -> MediaKind | None:
    """Reconhece o formato pelos primeiros bytes; o tipo declarado pelo remetente não é confiável."""
    head = data[:16]
    if head.startswith((b"OggS", b"ID3", b"#!AMR")) or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf1", b"\xff\xf9"):
        return MediaKind.AUDIO
    if head[4:8] == b"ftyp":
        return MediaKind.AUDIO
    if head.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) or (head[:4] == b"RIFF" and head[8:12] == b"WEBP"):
        return MediaKind.IMAGE
    return None


def validate(media: MediaToProcess, data: bytes) -> None:
    """Tamanho e tipo real do conteúdo contra o tipo declarado."""
    if len(data) > media.kind.max_bytes:
        raise MediaRejected(RejectionReason.TOO_LARGE)
    if sniff_kind(data) is not media.kind:
        raise MediaRejected(RejectionReason.TYPE_MISMATCH)


@dataclass(frozen=True)
class Transcript:
    text: str
    language: str
    duration_seconds: float

    def is_empty(self) -> bool:
        return self.text.strip() == ""
