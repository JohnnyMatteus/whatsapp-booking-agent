"""Adaptadores falsos: testes e execução local sem modelo de transcrição."""

from __future__ import annotations

from typing import Any

from ..domain import Transcript


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

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data


class StaticMediaSource:
    def __init__(self, data: bytes = b"OggS-fake-audio") -> None:
        self.data = data

    def fetch(self, media_id: str) -> bytes:
        return self.data


class RecordingPublisher:
    def __init__(self) -> None:
        self.published: list[dict[str, Any]] = []

    def publish(self, envelope: dict[str, Any]) -> None:
        self.published.append(envelope)
