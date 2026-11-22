#!/bin/sh
# Cria o bucket das mídias no MinIO (idempotente). Roda no contêiner minio-init.
set -eu
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "local/$MEDIA_BUCKET"
# Áudio e imagem de aluno são dados pessoais: expira em 30 dias.
mc ilm rule add --expire-days 30 "local/$MEDIA_BUCKET" >/dev/null 2>&1 || true
echo "bucket $MEDIA_BUCKET pronto"
