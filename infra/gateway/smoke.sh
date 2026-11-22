#!/usr/bin/env bash
# Smoke das políticas do gateway sem subir os serviços: sem upstream, uma requisição que passa
# pelas políticas recebe 502/503 do Kong; uma barrada por política recebe o código da política.
# Uso: infra/gateway/smoke.sh <url-do-gateway>
set -euo pipefail

BASE="${1:?informe a URL do gateway}"
# Chave privada cuja pública o Kong recebeu (PANEL_JWT_PUBLIC_KEY_FILE). Os tokens do smoke são locais:
# em operação normal quem emite é o Keycloak.
KEY="${PANEL_JWT_PRIVATE_KEY_FILE:?defina PANEL_JWT_PRIVATE_KEY_FILE (par da chave pública do gateway)}"
ISSUER="${OIDC_ISSUER:-http://127.0.0.1:8180/realms/wba}"
MINT="$(dirname "$0")/../../scripts/mint-panel-jwt.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
openssl genrsa -out "$WORK/stranger.pem" 2048 2>/dev/null
TOKEN="$("$MINT" "$KEY" 300 "$ISSUER")"
fail=0

expect() { # descrição, esperado (regex), obtido
  if [[ "$3" =~ ^($2)$ ]]; then echo "ok   $1 ($3)"; else echo "FALHA $1: esperado $2, veio $3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
bearer() { echo "Authorization: Bearer $1"; }

expect "painel sem JWT é barrado" 401 "$(code "$BASE/api/queue")"
expect "painel com JWT assinado por outra chave é barrado" 401 "$(code -H "$(bearer "$("$MINT" "$WORK/stranger.pem" 300 "$ISSUER")")" "$BASE/api/queue")"
expect "painel com JWT expirado é barrado" 401 "$(code -H "$(bearer "$("$MINT" "$KEY" -60 "$ISSUER")")" "$BASE/api/queue")"
expect "painel com JWT de validade acima do máximo é barrado" 401 "$(code -H "$(bearer "$("$MINT" "$KEY" 7200 "$ISSUER")")" "$BASE/api/queue")"
expect "painel com JWT de outro emissor é barrado" 401 "$(code -H "$(bearer "$("$MINT" "$KEY" 300 http://outro-idp.example/realms/x)")" "$BASE/api/queue")"
expect "painel com JWT válido passa pelas políticas" '502|503|504' "$(code -H "$(bearer "$TOKEN")" "$BASE/api/queue")"
# O Kong normaliza o caminho antes de casar a rota; nenhuma forma codificada pode escapar do JWT nem alcançar o upstream.
expect "caminho do painel codificado sem JWT não passa" '401|404' "$(code "$BASE/%61pi/queue")"
expect "caminho do painel codificado em outro segmento sem JWT não passa" '401|404' "$(code "$BASE/api/%71ueue")"
expect "caminho do painel codificado duas vezes sem JWT não passa" '401|404' "$(code "$BASE/%2561pi/queue")"
expect "caminho do painel codificado com JWT inválido não passa" '401|404' "$(code -H "$(bearer "$("$MINT" "$WORK/stranger.pem" 300 "$ISSUER")")" "$BASE/%61pi/queue")"
expect "API interna de mídia codificada não é exposta" 404 "$(code "$BASE/%69nternal/media/estudio-lotus/1")"
expect "API interna de avisos não é exposta" 404 "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/internal/tenants/estudio-lotus/notifications")"
expect "API interna de avisos codificada não é exposta" 404 "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/%69nternal/tenants/estudio-lotus/notifications")"
expect "webhook da Cloud API não exige JWT" '502|503|504' "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/webhooks/cloud-api")"
expect "webhook do Whatsmiau não exige JWT" '502|503|504' "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/webhooks/whatsmiau")"
expect "API interna de mídia não é exposta" 404 "$(code "$BASE/internal/media/estudio-lotus/1")"
expect "rota desconhecida" 404 "$(code "$BASE/qualquer")"
# O corpo vai por arquivo: no Linux um argumento passa de 128 KiB e o execve falha (E2BIG) antes do curl.
BIG_FILE="$(mktemp)"
trap 'rm -f "$BIG_FILE"' EXIT
head -c 300000 /dev/zero | tr '\0' 'a' > "$BIG_FILE"
expect "webhook da Cloud API acima de 256 KB é recusado" 413 "$(code -X POST -H 'Content-Type: application/json' --data-binary "@$BIG_FILE" "$BASE/webhooks/cloud-api")"
# Informativo: os cabeçalhos de cota dependem da versão do Kong e de a resposta vir do upstream.
curl -s -D - -o /dev/null -H "$(bearer "$TOKEN")" "$BASE/api/queue" | tr -d '\r' | grep -i 'ratelimit' || echo "aviso: sem cabeçalhos de cota na resposta"
exit "$fail"
