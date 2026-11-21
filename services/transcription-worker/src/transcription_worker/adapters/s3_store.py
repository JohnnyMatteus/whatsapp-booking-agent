"""Armazenamento do áudio original em S3 compatível (MinIO local, LocalStack ou AWS real)."""

from __future__ import annotations

from typing import Any


class S3MediaStore:
    def __init__(self, bucket: str, endpoint_url: str | None, region: str = "us-east-1") -> None:
        import boto3

        self._bucket = bucket
        self._client: Any = boto3.client("s3", endpoint_url=endpoint_url, region_name=region)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)
