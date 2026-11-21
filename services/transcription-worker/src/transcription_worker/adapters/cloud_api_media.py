"""Download de mídia pela Cloud API: GET /{media-id} devolve uma URL temporária, que exige o token."""

from __future__ import annotations

import httpx


class CloudApiMediaSource:
    def __init__(self, base_url: str, api_version: str, access_token: str, timeout: float = 15.0) -> None:
        self._client = httpx.Client(
            base_url=f"{base_url.rstrip('/')}/{api_version}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=timeout,
        )

    def fetch(self, media_id: str) -> bytes:
        meta = self._client.get(f"/{media_id}")
        meta.raise_for_status()
        download = self._client.get(meta.json()["url"])
        download.raise_for_status()
        return download.content
