#!/usr/bin/env bash
# Pede ao booking-agent um aviso por template (o SaaS chama esta mesma rota quando uma vaga
# da lista de espera é promovida). Variáveis: KIND, CONTACT, SESSION, DATE (AAAA-MM-DD), TENANT.
set -euo pipefail

: "${CONTACT:?informe CONTACT (wa_id do aluno)}" "${SESSION:?informe SESSION (id da aula)}" "${DATE:?informe DATE (AAAA-MM-DD)}"
port="${BOOKING_AGENT_PORT:-8081}"
tenant="${TENANT:-estudio-lotus}"

curl -fsS -X POST "http://127.0.0.1:${port}/internal/tenants/${tenant}/notifications" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN:-dev-only-internal-token}" \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"${KIND:-reminder}\",\"contactId\":\"${CONTACT}\",\"sessionId\":\"${SESSION}\",\"date\":\"${DATE}\"}"
echo
