#!/usr/bin/env bash
# Pede ao Keycloak local (realm wba) um access token de desenvolvimento, pelo cliente wba-dev-cli.
# Uso: scripts/panel-token.sh [usuario] (padrão ana.lotus); a senha de desenvolvimento é dev-only-<primeiro nome>.
set -euo pipefail

USER_NAME="${1:-ana.lotus}"
KEYCLOAK="${KEYCLOAK_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-8180}}"
curl -fsS "$KEYCLOAK/realms/wba/protocol/openid-connect/token" \
  --data-urlencode grant_type=password --data-urlencode client_id=wba-dev-cli \
  --data-urlencode "username=${USER_NAME}@example.com" --data-urlencode "password=dev-only-${USER_NAME%%.*}" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
