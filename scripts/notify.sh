#!/usr/bin/env bash
# Pede ao booking-agent um aviso por template (o SaaS chama esta mesma rota quando uma vaga
# da lista de espera é promovida). A porta do booking-agent não é publicada no host: a chamada
# sai de dentro da rede do compose. Variáveis: KIND, CONTACT, SESSION, DATE (AAAA-MM-DD), TENANT.
set -euo pipefail

: "${CONTACT:?informe CONTACT (wa_id do aluno)}" "${SESSION:?informe SESSION (id da aula)}" "${DATE:?informe DATE (AAAA-MM-DD)}"
tenant="${TENANT:-estudio-lotus}"

docker compose --profile core exec -T booking-agent wget -qO- \
  --header "Authorization: Bearer ${INTERNAL_API_TOKEN:-dev-only-internal-token}" \
  --header 'Content-Type: application/json' \
  --post-data "{\"kind\":\"${KIND:-reminder}\",\"contactId\":\"${CONTACT}\",\"sessionId\":\"${SESSION}\",\"date\":\"${DATE}\"}" \
  "http://127.0.0.1:8081/internal/tenants/${tenant}/notifications"
echo
