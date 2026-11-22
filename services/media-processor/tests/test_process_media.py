from __future__ import annotations

import io
from typing import Any

import pytest
from PIL import Image

from media_processor.adapters.fake import (
    FakeThumbnailGenerator,
    FakeTranscriber,
    InMemoryMediaStore,
    RecordingPublisher,
    StaticMediaSource,
)
from media_processor.adapters.pillow_thumbnail import PillowThumbnailGenerator
from media_processor.contracts import ContractViolation
from media_processor.domain import MAX_AUDIO_BYTES, MAX_IMAGE_BYTES
from media_processor.service import ProcessMedia


def envelope(**payload_overrides: Any) -> dict[str, Any]:
    payload = {
        "tenantId": "estudio-lotus",
        "contactId": "5511900000002",
        "messageId": "wamid.AUDIO1",
        "receivedAt": "2026-03-02T12:01:00.000Z",
        "kind": "audio",
        "mediaId": "900000000000001",
        "mimeType": "audio/ogg; codecs=opus",
        **payload_overrides,
    }
    return {
        "id": "7d4b0f0e-2f0a-4f43-8a3c-000000000020",
        "type": "inbound.media_received",
        "version": 1,
        "occurredAt": "2026-03-02T12:01:01.000Z",
        "correlationId": "wamid.AUDIO1",
        "payload": payload,
    }


def png(size: tuple[int, int] = (1024, 768)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (200, 120, 40)).save(out, format="PNG")
    return out.getvalue()


def make(
    text: str = "quero reservar o pilates de amanhã", data: bytes = b"OggS-fake", real_thumbnails: bool = False
) -> tuple[ProcessMedia, Any]:
    store, publisher, transcriber = InMemoryMediaStore(), RecordingPublisher(), FakeTranscriber(text)
    thumbnails = PillowThumbnailGenerator() if real_thumbnails else FakeThumbnailGenerator()
    source = StaticMediaSource(data)
    service = ProcessMedia(source, store, transcriber, thumbnails, publisher)
    return service, (store, publisher, transcriber, source)


def by_type(publisher: RecordingPublisher, type_: str) -> dict[str, Any]:
    [found] = [e for e in publisher.published if e["type"] == type_]
    return found


def test_audio_vira_texto_do_aluno_e_midia_processada() -> None:
    service, (store, publisher, _, source) = make()

    assert service.handle(envelope()) == "transcribed"

    message = by_type(publisher, "inbound.message_received")
    assert message["correlationId"] == "wamid.AUDIO1"
    assert message["payload"]["messageId"] == "wamid.AUDIO1"
    assert message["payload"]["content"] == {
        "kind": "text",
        "text": "quero reservar o pilates de amanhã",
        "transcribed": True,
    }
    processed = by_type(publisher, "media.processed")["payload"]
    assert processed | {} == {
        "tenantId": "estudio-lotus",
        "contactId": "5511900000002",
        "messageId": "wamid.AUDIO1",
        "receivedAt": "2026-03-02T12:01:00.000Z",
        "kind": "audio",
        "status": "processed",
        "mimeType": "audio/ogg; codecs=opus",
        "transcribed": True,
        "sizeBytes": len(b"OggS-fake"),
        "storageKey": "media/estudio-lotus/2026-03-02/900000000000001",
    }
    assert list(store.objects) == ["media/estudio-lotus/2026-03-02/900000000000001"]
    assert source.requests == [("estudio-lotus", "900000000000001")]


def test_audio_sem_fala_vira_midia_sem_suporte_mas_fica_guardado() -> None:
    service, (store, publisher, _, _) = make(text="   ")

    assert service.handle(envelope()) == "empty"
    content = by_type(publisher, "inbound.message_received")["payload"]["content"]
    assert content == {"kind": "unsupported", "description": "empty_audio"}
    assert by_type(publisher, "media.processed")["payload"]["transcribed"] is False
    assert len(store.objects) == 1


def test_imagem_guarda_original_e_miniatura_real() -> None:
    service, (store, publisher, transcriber, _) = make(data=png(), real_thumbnails=True)

    assert service.handle(envelope(kind="image", mimeType="image/png", mediaId="img1")) == "stored"

    base = "media/estudio-lotus/2026-03-02/img1"
    assert set(store.objects) == {base, f"{base}.thumb.jpg"}
    assert store.content_types[f"{base}.thumb.jpg"] == "image/jpeg"
    thumb = Image.open(io.BytesIO(store.objects[f"{base}.thumb.jpg"]))
    assert thumb.format == "JPEG"
    assert max(thumb.size) == 256
    processed = by_type(publisher, "media.processed")["payload"]
    assert processed["thumbnailKey"] == f"{base}.thumb.jpg"
    assert processed["status"] == "processed"
    assert transcriber.calls == 0
    # O agente não lê imagem: o aluno recebe a orientação de mídia sem suporte.
    assert by_type(publisher, "inbound.message_received")["payload"]["content"] == {
        "kind": "unsupported",
        "description": "image",
    }


def test_imagem_corrompida_e_rejeitada_sem_guardar() -> None:
    service, (store, publisher, _, _) = make(data=b"\x89PNG\r\n\x1a\nlixo", real_thumbnails=True)

    assert service.handle(envelope(kind="image", mimeType="image/png")) == "rejected"
    assert store.objects == {}
    assert by_type(publisher, "media.processed")["payload"]["rejectionReason"] == "corrupt"


@pytest.mark.parametrize(
    ("overrides", "data", "reason"),
    [
        ({"mimeType": "video/mp4"}, b"OggS-x", "unsupported_type"),
        ({}, b"OggS" + b"x" * MAX_AUDIO_BYTES, "too_large"),
        ({"kind": "image", "mimeType": "image/jpeg"}, b"\xff\xd8\xff" + b"x" * MAX_IMAGE_BYTES, "too_large"),
        ({}, b"\xff\xd8\xff-na-verdade-uma-imagem", "type_mismatch"),
        ({"kind": "image", "mimeType": "image/png"}, b"OggS-na-verdade-um-audio", "type_mismatch"),
        ({}, b"MZ-executavel-disfarcado", "type_mismatch"),
    ],
    ids=[
        "formato",
        "audio-grande",
        "imagem-grande",
        "audio-com-bytes-de-imagem",
        "imagem-com-bytes-de-audio",
        "executavel",
    ],
)
def test_rejeita_sem_guardar_nem_transcrever_e_avisa_o_aluno(
    overrides: dict[str, Any], data: bytes, reason: str
) -> None:
    service, (store, publisher, transcriber, _) = make(data=data)

    assert service.handle(envelope(**overrides)) == "rejected"
    assert transcriber.calls == 0
    assert store.objects == {}
    processed = by_type(publisher, "media.processed")["payload"]
    assert (processed["status"], processed["rejectionReason"]) == ("rejected", reason)
    assert by_type(publisher, "inbound.message_received")["payload"]["content"]["kind"] == "unsupported"


def test_chave_de_armazenamento_nao_aceita_caracteres_de_caminho() -> None:
    service, (store, _, _, _) = make()

    service.handle(envelope(mediaId="../../etc/passwd"))

    assert list(store.objects) == ["media/estudio-lotus/2026-03-02/.._.._etc_passwd"]


@pytest.mark.parametrize(
    "broken",
    [{"version": 2}, {"type": "inbound.message_received"}, {"payload": None}],
    ids=["versao", "tipo", "payload"],
)
def test_mensagem_fora_do_contrato(broken: dict[str, Any]) -> None:
    service, _ = make()

    with pytest.raises(ContractViolation):
        service.handle({**envelope(), **broken})


def test_campo_obrigatorio_vazio_e_kind_invalido() -> None:
    service, _ = make()

    with pytest.raises(ContractViolation, match="mediaId"):
        service.handle(envelope(mediaId=""))
    with pytest.raises(ContractViolation, match="kind"):
        service.handle(envelope(kind="video"))
