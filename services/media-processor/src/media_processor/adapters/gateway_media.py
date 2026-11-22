"""Download de mídia pela API interna do messaging-gateway: o serviço não conhece provedores de WhatsApp."""

from __future__ import annotations

from urllib.parse import quote

import httpx

from ..domain import MediaRejected, RejectionReason


class GatewayMediaSource:
    def __init__(self, base_url: str, internal_token: str, timeout: float = 30.0) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-internal-token": internal_token}, timeout=timeout
        )

    def fetch(self, tenant_id: str, media_id: str, max_bytes: int) -> bytes:
        path = f"/internal/media/{quote(tenant_id, safe='')}/{quote(media_id, safe='')}"
        with self._client.stream("GET", path) as response:
            if response.status_code == 404:
                raise MediaRejected(RejectionReason.UNAVAILABLE)
            response.raise_for_status()  # 5xx do gateway/provedor: erro transitório, a fila reentrega
            chunks: list[bytes] = []
            received = 0
            for chunk in response.iter_bytes():
                received += len(chunk)
                if received > max_bytes:
                    raise MediaRejected(RejectionReason.TOO_LARGE)
                chunks.append(chunk)
        return b"".join(chunks)
