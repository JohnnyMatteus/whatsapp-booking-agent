#!/usr/bin/env bash
# Gera um JWT HS256 de desenvolvimento para o painel (iss=wba-panel), assinado com o segredo que
# o api-gateway valida. Em produção quem emite é o provedor de identidade (ADR 0012).
# Uso: PANEL_JWT_SECRET=... scripts/mint-panel-jwt.sh [segundos-de-validade]  (0 = sem exp)
set -euo pipefail

SECRET="${PANEL_JWT_SECRET:-dev-only-panel-jwt-secret-change-me}"
TTL="${1:-0}"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

HEADER=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
if [ "$TTL" -gt 0 ]; then
  PAYLOAD=$(printf '{"iss":"wba-panel","sub":"painel","exp":%s}' "$(( $(date +%s) + TTL ))" | b64url)
else
  PAYLOAD=$(printf '{"iss":"wba-panel","sub":"painel"}' | b64url)
fi
SIGNATURE=$(printf '%s.%s' "$HEADER" "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
printf '%s.%s.%s\n' "$HEADER" "$PAYLOAD" "$SIGNATURE"
