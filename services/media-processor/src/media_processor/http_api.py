"""API HTTP interna do serviço: miniaturas para o painel (via booking-agent) e métricas.

Só rede interna, sem rota no api-gateway. A chave da miniatura é validada por padrão fechado: o cliente
não consegue pedir um original nem sair do prefixo `media/`.
"""

from __future__ import annotations

import hmac
import re
from collections.abc import Callable, Mapping
from typing import NamedTuple
from urllib.parse import parse_qs, urlsplit

from .ports import MediaStore

THUMBNAIL_KEY = re.compile(r"^media/[A-Za-z0-9._-]+/\d{4}-\d{2}-\d{2}/[A-Za-z0-9._-]+\.thumb\.jpg$")
TOKEN_HEADER = "x-internal-token"


class Response(NamedTuple):
    status: int
    content_type: str
    body: bytes


def handle_request(
    path: str,
    headers: Mapping[str, str],
    store: MediaStore,
    internal_token: str,
    render_metrics: Callable[[], tuple[str, bytes]],
) -> Response:
    url = urlsplit(path)
    if url.path == "/metrics":
        content_type, body = render_metrics()
        return Response(200, content_type, body)
    if url.path != "/internal/thumbnails":
        return Response(404, "text/plain", b"not found")
    if not hmac.compare_digest(headers.get(TOKEN_HEADER, "").encode(), internal_token.encode()):
        return Response(401, "text/plain", b"unauthorized")
    key = parse_qs(url.query).get("key", [""])[0]
    if not THUMBNAIL_KEY.fullmatch(key):
        return Response(400, "text/plain", b"invalid key")
    data = store.get(key)
    return Response(404, "text/plain", b"not found") if data is None else Response(200, "image/jpeg", data)
