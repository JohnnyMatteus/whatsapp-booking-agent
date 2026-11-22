#!/usr/bin/env bash
# Smoke das políticas do gateway sem subir os serviços: sem upstream, uma requisição que passa
# pelas políticas recebe 502/503 do Kong; uma barrada por política recebe o código da política.
# Uso: infra/gateway/smoke.sh <url-do-gateway>
set -euo pipefail

BASE="${1:?informe a URL do gateway}"
SECRET="${PANEL_JWT_SECRET:-dev-only-panel-jwt-secret-change-me}"
TOKEN="$(PANEL_JWT_SECRET="$SECRET" "$(dirname "$0")/../../scripts/mint-panel-jwt.sh")"
fail=0

expect() { # descrição, esperado (regex), obtido
  if [[ "$3" =~ ^($2)$ ]]; then echo "ok   $1 ($3)"; else echo "FALHA $1: esperado $2, veio $3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

expect "painel sem JWT é barrado" 401 "$(code "$BASE/api/queue")"
FORGED="$(PANEL_JWT_SECRET=outro-segredo-qualquer "$(dirname "$0")/../../scripts/mint-panel-jwt.sh")"
expect "painel com JWT de outro segredo é barrado" 401 "$(code -H "Authorization: Bearer $FORGED" "$BASE/api/queue")"
expect "painel com JWT válido passa pelas políticas" '502|503|504' "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/queue")"
expect "webhook da Cloud API não exige JWT" '502|503|504' "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/webhooks/cloud-api")"
expect "webhook do Whatsmiau não exige JWT" '502|503|504' "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/webhooks/whatsmiau")"
expect "API interna de mídia não é exposta" 404 "$(code "$BASE/internal/media/estudio-lotus/1")"
expect "rota desconhecida" 404 "$(code "$BASE/qualquer")"
big=$(head -c 300000 /dev/zero | tr '\0' 'a')
expect "webhook da Cloud API acima de 256 KB é recusado" 413 "$(code -X POST -H 'Content-Type: application/json' --data "$big" "$BASE/webhooks/cloud-api")"
# Informativo: os cabeçalhos de cota dependem da versão do Kong e de a resposta vir do upstream.
curl -s -D - -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/api/queue" | tr -d '\r' | grep -i 'ratelimit' || echo "aviso: sem cabeçalhos de cota na resposta"
exit "$fail"
