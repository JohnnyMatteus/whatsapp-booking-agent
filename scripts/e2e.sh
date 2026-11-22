#!/usr/bin/env bash
# Ponta a ponta contra o compose no ar (profile core): webhook assinado -> Kong -> messaging-gateway ->
# RabbitMQ -> booking-agent -> saas-mcp-server (mock do SaaS) -> resposta no mock da Cloud API, e o painel
# autenticado pelo Keycloak real, com isolamento entre estúdios. Roda no CI (job e2e); localmente, com o
# ambiente já de pé: `make up && scripts/e2e.sh`.
set -euo pipefail

GATEWAY="http://127.0.0.1:${GATEWAY_PORT:-8000}"
MOCK="http://127.0.0.1:${CLOUD_API_MOCK_PORT:-9090}"
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0

ok() { echo "ok   $1"; }
bad() { echo "FALHA $1"; fail=1; }
expect() { # descrição, esperado (regex), obtido
  if [[ "$3" =~ ^($2)$ ]]; then ok "$1 ($3)"; else bad "$1: esperado $2, veio $3"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Envios da Cloud API ao mock, para o contato de teste: quantos e o corpo do último.
sent_count() {
  curl -fsS "$MOCK/__admin/requests" | python3 -c '
import json, sys
reqs = json.load(sys.stdin)["requests"]
print(sum(1 for r in reqs if r["request"]["method"] == "POST" and "/messages" in r["request"]["url"] and "\"to\":\"5511900000001\"" in r["request"]["body"].replace(" ", "")))'
}
wait_until() { # descrição, tentativas, comando...
  local description="$1" attempts="$2"; shift 2
  for _ in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then ok "$description"; return 0; fi
    sleep 2
  done
  bad "$description (não aconteceu a tempo)"
  return 1
}

curl -fsS -X DELETE "$MOCK/__admin/requests" >/dev/null
before="$(sent_count)"

echo "== webhook da Cloud API"
ID="wamid.E2E$(date +%s)$RANDOM"
MESSAGE_ID="$ID" "$HERE/seed-webhook.sh" "Quais horários tem amanhã?" >/dev/null && ok "webhook assinado aceito" || bad "webhook assinado aceito"
reply_arrived() { [ "$(sent_count)" -gt "$before" ]; }
wait_until "a resposta do bot chega ao mock da Cloud API" 45 reply_arrived || true
after="$(sent_count)"

MESSAGE_ID="$ID" "$HERE/seed-webhook.sh" "Quais horários tem amanhã?" >/dev/null && ok "reentrega aceita (200)" || bad "reentrega aceita (200)"
sleep 6
expect "a reentrega do mesmo id não gera segunda resposta" "$after" "$(sent_count)"

BODY='{"object":"whatsapp_business_account","entry":[]}'
expect "assinatura inválida é recusada" 401 "$(code -X POST -H 'Content-Type: application/json' -H 'X-Hub-Signature-256: sha256=00' -d "$BODY" "$GATEWAY/webhooks/cloud-api")"
expect "webhook sem assinatura é recusado" 401 "$(code -X POST -H 'Content-Type: application/json' -d "$BODY" "$GATEWAY/webhooks/cloud-api")"

echo "== painel autenticado pelo Keycloak"
token() { "$HERE/panel-token.sh" "$1"; }
ANA="$(token ana.lotus)"
BIA="$(token bia.lotus)"
CAIO="$(token caio.sol)"
api() { local bearer="$1" path="$2"; shift 2; code -H "Authorization: Bearer $bearer" "$@" "$GATEWAY$path"; }

expect "sem token: 401" 401 "$(code "$GATEWAY/api/tenants/estudio-lotus/conversations")"
expect "caminho codificado sem token: 401 ou 404" '401|404' "$(code "$GATEWAY/%61pi/tenants/estudio-lotus/conversations")"
expect "atendente do estúdio lê a fila" 200 "$(api "$ANA" /api/tenants/estudio-lotus/conversations)"
expect "atendente de outro estúdio não lê a fila" 403 "$(api "$CAIO" /api/tenants/estudio-lotus/conversations)"
expect "atendente não vê métricas" 403 "$(api "$ANA" /api/tenants/estudio-lotus/metrics)"
expect "gerente vê métricas" 200 "$(api "$BIA" /api/tenants/estudio-lotus/metrics)"
expect "gerente de outro estúdio não vê métricas" 403 "$(api "$CAIO" /api/tenants/estudio-lotus/metrics)"

LIST="$(curl -fsS -H "Authorization: Bearer $ANA" "$GATEWAY/api/tenants/estudio-lotus/conversations")"
python3 - "$LIST" <<'PY' && ok "a conversa do webhook aparece na fila, com o contato mascarado" || bad "a conversa do webhook aparece na fila, com o contato mascarado"
import json, sys
data = json.loads(sys.argv[1])
ids = [c["conversationId"] for c in data["data"]]
assert "estudio-lotus:5511900000001" in ids, ids
assert all("5511900000001" not in c.get("contact", "") for c in data["data"])
PY

expect "API interna não tem rota no gateway" 404 "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$GATEWAY/internal/tenants/estudio-lotus/notifications")"
expect "API interna codificada não tem rota no gateway" 404 "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$GATEWAY/%69nternal/tenants/estudio-lotus/notifications")"

exit "$fail"
