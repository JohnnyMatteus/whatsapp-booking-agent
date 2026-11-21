"""Modelo do worker: o áudio a transcrever e o resultado. Sem dependências externas."""

from __future__ import annotations

from dataclasses import dataclass

# Notas de voz típicas têm segundos; 16 MB é o limite de áudio da Cloud API.
MAX_AUDIO_BYTES = 16 * 1024 * 1024
SUPPORTED_MIME_PREFIXES = ("audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr")


class TranscriptionRejected(Exception):
    """Áudio que não deve ser transcrito (formato ou tamanho). Não adianta tentar de novo."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AudioToTranscribe:
    tenant_id: str
    contact_id: str
    message_id: str
    received_at: str
    media_id: str
    mime_type: str

    def check_format(self) -> None:
        if not self.mime_type.lower().startswith(SUPPORTED_MIME_PREFIXES):
            raise TranscriptionRejected(f"formato não suportado: {self.mime_type}")


@dataclass(frozen=True)
class Transcript:
    text: str
    language: str
    duration_seconds: float

    def is_empty(self) -> bool:
        return self.text.strip() == ""
