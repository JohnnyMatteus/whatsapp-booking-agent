from __future__ import annotations

import pytest

from media_processor.adapters.fake import InMemoryMediaStore
from media_processor.http_api import handle_request

KEY = "media/estudio-lotus/2026-03-02/m1.thumb.jpg"
TOKEN = "dev-only-media-token"


def call(path: str, store: InMemoryMediaStore, token: str | None = TOKEN):
    headers = {} if token is None else {"x-internal-token": token}
    return handle_request(path, headers, store, TOKEN, lambda: ("text/plain", b"wba_ok 1"))


def test_serve_a_miniatura_com_o_token_de_servico() -> None:
    store = InMemoryMediaStore()
    store.put(KEY, b"\xff\xd8\xff-thumb", "image/jpeg")

    response = call(f"/internal/thumbnails?key={KEY}", store)

    assert (response.status, response.content_type, response.body) == (200, "image/jpeg", b"\xff\xd8\xff-thumb")


def test_exige_o_token() -> None:
    store = InMemoryMediaStore()
    store.put(KEY, b"x", "image/jpeg")

    assert call(f"/internal/thumbnails?key={KEY}", store, token=None).status == 401
    assert call(f"/internal/thumbnails?key={KEY}", store, token="outro").status == 401


@pytest.mark.parametrize(
    "key",
    [
        "media/estudio-lotus/2026-03-02/m1",  # o original, não a miniatura
        "media/../segredo.thumb.jpg",
        "outro/estudio/2026-03-02/m1.thumb.jpg",
        "media/estudio/2026-03-02/../../x.thumb.jpg",
        "",
    ],
)
def test_recusa_chave_fora_do_padrao_de_miniatura(key: str) -> None:
    store = InMemoryMediaStore()
    store.put(key, b"secreto", "image/jpeg")

    assert call(f"/internal/thumbnails?key={key}", store).status == 400


def test_404_quando_a_miniatura_expirou_e_metricas_sem_token() -> None:
    assert call(f"/internal/thumbnails?key={KEY}", InMemoryMediaStore()).status == 404
    assert call("/metrics", InMemoryMediaStore(), token=None).body == b"wba_ok 1"
    assert call("/qualquer", InMemoryMediaStore()).status == 404
