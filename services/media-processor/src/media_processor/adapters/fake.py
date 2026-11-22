"""Adaptadores falsos: testes e execução local sem modelo de transcrição."""

from __future__ import annotations

from typing import Any

from ..domain import MediaRejected, RejectionReason, Transcript


class FakeTranscriber:
    def __init__(self, text: str = "quais horários tem amanhã") -> None:
        self.text = text
        self.calls = 0

    def transcribe(self, audio: bytes, mime_type: str) -> Transcript:
        self.calls += 1
        return Transcript(text=self.text, language="pt", duration_seconds=2.5)


class InMemoryMediaStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data
        self.content_types[key] = content_type


class StaticMediaSource:
    def __init__(self, data: bytes = b"OggS-fake-audio") -> None:
        self.data = data
        self.requests: list[tuple[str, str]] = []

    def fetch(self, tenant_id: str, media_id: str, max_bytes: int) -> bytes:
        self.requests.append((tenant_id, media_id))
        if len(self.data) > max_bytes:
            raise MediaRejected(RejectionReason.TOO_LARGE)
        return self.data


class FakeThumbnailGenerator:
    def generate(self, image: bytes) -> bytes:
        return b"\xff\xd8\xff-thumb"


class RecordingPublisher:
    def __init__(self) -> None:
        self.published: list[dict[str, Any]] = []

    def publish(self, envelope: dict[str, Any]) -> None:
        self.published.append(envelope)
