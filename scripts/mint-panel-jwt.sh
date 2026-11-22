#!/usr/bin/env bash
# Gera um JWT RS256 de teste com a chave privada indicada. Serve ao smoke do api-gateway (CI), onde o
# Kong recebe a chave pública correspondente; em uso normal quem emite é o Keycloak (scripts/panel-token.sh).
# Uso: scripts/mint-panel-jwt.sh <chave-privada.pem> [segundos-de-validade] [iss] [tenant] [role]
set -euo pipefail

KEY="${1:?informe a chave privada PEM}"
TTL="${2:-300}"
ISS="${3:-http://127.0.0.1:8180/realms/wba}"
TENANT="${4:-estudio-lotus}"
ROLE="${5:-attendant}"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

NOW=$(date +%s)
HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
PAYLOAD=$(printf '{"iss":"%s","sub":"smoke","aud":"wba-api","iat":%s,"exp":%s,"realm_access":{"roles":["%s","tenant:%s"]}}' "$ISS" "$NOW" "$(( NOW + TTL ))" "$ROLE" "$TENANT" | b64url)
SIGNATURE=$(printf '%s.%s' "$HEADER" "$PAYLOAD" | openssl dgst -sha256 -sign "$KEY" -binary | b64url)
printf '%s.%s.%s\n' "$HEADER" "$PAYLOAD" "$SIGNATURE"
