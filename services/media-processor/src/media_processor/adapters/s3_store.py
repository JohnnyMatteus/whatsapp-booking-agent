"""Armazenamento das mídias em S3 (LocalStack no desenvolvimento, AWS real em produção)."""

from __future__ import annotations

from typing import Any


class S3MediaStore:
    def __init__(self, bucket: str, endpoint_url: str | None, region: str = "us-east-1") -> None:
        import boto3
        from botocore.config import Config

        self._bucket = bucket
        # Path-style (http://endpoint/bucket/chave): um endpoint local como http://localstack:4566 não resolve
        # `bucket.localstack` por DNS. Na AWS real o path-style também funciona para o bucket da região.
        self._client: Any = boto3.client(
            "s3", endpoint_url=endpoint_url, region_name=region, config=Config(s3={"addressing_style": "path"})
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes | None:
        from botocore.exceptions import ClientError

        try:
            body: bytes = self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        return body
