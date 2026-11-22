#!/usr/bin/env bash
# Envia ao webhook local uma mensagem de exemplo assinada como a Meta assinaria
# (HMAC-SHA256 do corpo com o App Secret). Uso: scripts/seed-webhook.sh ["texto"]
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:${GATEWAY_PORT:-8000}/webhooks/cloud-api}"
SECRET="${WHATSAPP_APP_SECRET:-dev-only-change-me-app-secret}"
TEXT="${1:-Quais horários tem amanhã?}"
NOW="$(date +%s)"
MESSAGE_ID="${MESSAGE_ID:-wamid.SEED${NOW}${RANDOM}}"

BODY=$(printf '{"object":"whatsapp_business_account","entry":[{"id":"200000000000001","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550000001","phone_number_id":"100000000000001"},"contacts":[{"profile":{"name":"Aluna Exemplo"},"wa_id":"5511900000001"}],"messages":[{"from":"5511900000001","id":"%s","timestamp":"%s","type":"text","text":{"body":"%s"}}]}}]}]}' "$MESSAGE_ID" "$NOW" "$TEXT")
SIGNATURE="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"

curl -fsS -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data-raw "$BODY"
echo
echo "enviado $MESSAGE_ID; a resposta do bot aparece em http://127.0.0.1:${CLOUD_API_MOCK_PORT:-9090}/__admin/requests"
