#!/bin/sh
# Cria o bucket dos áudios no MinIO (idempotente). Roda no contêiner minio-init.
set -eu
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "local/$AUDIO_BUCKET"
# Áudio de aluno é dado pessoal: expira em 30 dias.
mc ilm rule add --expire-days 30 "local/$AUDIO_BUCKET" >/dev/null 2>&1 || true
echo "bucket $AUDIO_BUCKET pronto"
