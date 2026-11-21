from __future__ import annotations

from typing import Any

import pytest

from transcription_worker.adapters.fake import (
    FakeTranscriber,
    InMemoryMediaStore,
    RecordingPublisher,
    StaticMediaSource,
)
from transcription_worker.contracts import ContractViolation
from transcription_worker.domain import MAX_AUDIO_BYTES
from transcription_worker.service import TranscribeAudio


def envelope(**payload_overrides: Any) -> dict[str, Any]:
    payload = {
        "tenantId": "estudio-lotus",
        "contactId": "5511900000002",
        "messageId": "wamid.AUDIO1",
        "receivedAt": "2026-03-02T12:01:00.000Z",
        "mediaId": "900000000000001",
        "mimeType": "audio/ogg; codecs=opus",
        **payload_overrides,
    }
    return {
        "id": "7d4b0f0e-2f0a-4f43-8a3c-000000000020",
        "type": "inbound.audio_received",
        "version": 1,
        "occurredAt": "2026-03-02T12:01:01.000Z",
        "correlationId": "wamid.AUDIO1",
        "payload": payload,
    }


def make(text: str = "quero reservar o pilates de amanhã", audio: bytes = b"OggS-fake") -> tuple[TranscribeAudio, Any]:
    store, publisher, transcriber = InMemoryMediaStore(), RecordingPublisher(), FakeTranscriber(text)
    service = TranscribeAudio(StaticMediaSource(audio), store, transcriber, publisher)
    return service, (store, publisher, transcriber)


def test_publica_o_texto_como_a_mesma_mensagem_do_aluno() -> None:
    service, (store, publisher, _) = make()

    assert service.handle(envelope()) == "transcribed"

    [published] = publisher.published
    assert published["type"] == "inbound.message_received"
    assert published["correlationId"] == "wamid.AUDIO1"
    assert published["payload"]["messageId"] == "wamid.AUDIO1"
    assert published["payload"]["content"] == {
        "kind": "text",
        "text": "quero reservar o pilates de amanhã",
        "transcribed": True,
    }
    assert list(store.objects) == ["audio/estudio-lotus/2026-03-02/900000000000001"]


def test_audio_sem_fala_vira_midia_sem_suporte() -> None:
    service, (_, publisher, _) = make(text="   ")

    assert service.handle(envelope()) == "empty"
    assert publisher.published[0]["payload"]["content"] == {"kind": "unsupported", "description": "empty_audio"}


@pytest.mark.parametrize(
    ("overrides", "audio"),
    [({"mimeType": "video/mp4"}, b"x"), ({}, b"x" * (MAX_AUDIO_BYTES + 1))],
    ids=["formato", "tamanho"],
)
def test_rejeita_sem_transcrever_e_avisa_o_aluno(overrides: dict[str, Any], audio: bytes) -> None:
    service, (store, publisher, transcriber) = make(audio=audio)

    assert service.handle(envelope(**overrides)) == "rejected"
    assert transcriber.calls == 0
    assert store.objects == {}
    assert publisher.published[0]["payload"]["content"]["kind"] == "unsupported"


@pytest.mark.parametrize("broken", [{"version": 2}, {"type": "inbound.message_received"}, {"payload": None}])
def test_mensagem_fora_do_contrato(broken: dict[str, Any]) -> None:
    service, _ = make()

    with pytest.raises(ContractViolation):
        service.handle({**envelope(), **broken})


def test_campo_obrigatorio_vazio() -> None:
    service, _ = make()

    with pytest.raises(ContractViolation, match="mediaId"):
        service.handle(envelope(mediaId=""))
