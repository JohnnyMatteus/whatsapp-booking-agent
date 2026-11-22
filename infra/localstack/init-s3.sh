#!/bin/sh
# Cria o bucket das mídias e o ciclo de vida de 30 dias (dado pessoal). O LocalStack executa os scripts de
# /etc/localstack/init/ready.d quando está pronto; o healthcheck do compose só fica saudável depois deste script.
# Idempotente: pode rodar de novo sem erro. Variável de ambiente: MEDIA_BUCKET.
set -eu

: "${MEDIA_BUCKET:?defina MEDIA_BUCKET}"

if ! awslocal s3api head-bucket --bucket "$MEDIA_BUCKET" 2>/dev/null; then
  awslocal s3api create-bucket --bucket "$MEDIA_BUCKET"
fi
awslocal s3api put-bucket-lifecycle-configuration --bucket "$MEDIA_BUCKET" \
  --lifecycle-configuration '{"Rules":[{"ID":"expira-30-dias","Status":"Enabled","Filter":{"Prefix":"media/"},"Expiration":{"Days":30}}]}'
echo "bucket $MEDIA_BUCKET pronto, com expiração de 30 dias"
