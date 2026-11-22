#!/usr/bin/env bash
# Envia ao webhook local uma mensagem de exemplo no formato do Whatsmiau (Evolution API), com o
# segredo que a instância manda no cabeçalho x-webhook-secret. Uso: scripts/seed-whatsmiau.sh ["texto"]
# Requer o estúdio estudio-sol no TENANT_CHANNELS (make up-whatsmiau).
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:${GATEWAY_PORT:-8000}/webhooks/whatsmiau}"
SECRET="${WHATSMIAU_WEBHOOK_SECRET:-dev-only-whatsmiau-webhook-secret}"
INSTANCE="${INSTANCE:-estudio-sol}"
TEXT="${1:-Quais horários tem amanhã?}"
NOW="$(date +%s)"
MESSAGE_ID="3EB0SEED${NOW}${RANDOM}"

BODY=$(printf '{"event":"messages.upsert","instance":"%s","data":{"key":{"remoteJid":"5511900000001@s.whatsapp.net","fromMe":false,"id":"%s"},"pushName":"Aluna Exemplo","message":{"conversation":"%s"},"messageType":"conversation","messageTimestamp":%s}}' "$INSTANCE" "$MESSAGE_ID" "$TEXT" "$NOW")

curl -fsS -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H "x-webhook-secret: $SECRET" \
  --data-raw "$BODY"
echo
echo "enviado $MESSAGE_ID; a resposta do bot aparece em http://127.0.0.1:${WHATSMIAU_MOCK_PORT:-9092}/__admin/requests"
