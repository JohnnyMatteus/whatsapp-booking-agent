from __future__ import annotations

import httpx
import pytest

from media_processor.adapters.gateway_media import GatewayMediaSource
from media_processor.domain import MediaRejected, RejectionReason


def source(handler: httpx.MockTransport) -> GatewayMediaSource:
    result = GatewayMediaSource("http://gateway.local", "dev-only-internal-token")
    result._client = httpx.Client(
        transport=handler, base_url="http://gateway.local", headers={"x-internal-token": "dev-only-internal-token"}
    )
    return result


def test_baixa_pelo_gateway_com_token_de_servico_e_escapa_o_caminho() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"OggS-fake")

    assert source(httpx.MockTransport(handler)).fetch("estudio-lotus", "a/b", 100) == b"OggS-fake"
    assert seen[0].url.raw_path == b"/internal/media/estudio-lotus/a%2Fb"
    assert seen[0].headers["x-internal-token"] == "dev-only-internal-token"


def test_midia_indisponivel_e_rejeicao_permanente() -> None:
    with pytest.raises(MediaRejected) as raised:
        source(httpx.MockTransport(lambda _: httpx.Response(404))).fetch("t", "m", 100)

    assert raised.value.reason is RejectionReason.UNAVAILABLE


def test_para_de_ler_quando_passa_do_limite() -> None:
    with pytest.raises(MediaRejected) as raised:
        source(httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * 50))).fetch("t", "m", 10)

    assert raised.value.reason is RejectionReason.TOO_LARGE


def test_erro_do_gateway_e_transitorio() -> None:
    with pytest.raises(httpx.HTTPStatusError):
        source(httpx.MockTransport(lambda _: httpx.Response(502))).fetch("t", "m", 10)
