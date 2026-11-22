#!/bin/sh
# Renderiza o kong.yaml com os segredos do ambiente e inicia o Kong.
set -eu
: "${PANEL_API_TOKEN:?defina PANEL_API_TOKEN}" "${PANEL_JWT_SECRET:?defina PANEL_JWT_SECRET}"
# sed com delimitador que não aparece em segredos; falha se sobrar marcador sem valor.
sed -e "s|__PANEL_API_TOKEN__|${PANEL_API_TOKEN}|g" -e "s|__PANEL_JWT_SECRET__|${PANEL_JWT_SECRET}|g" \
  /kong/declarative/kong.yaml > /tmp/kong.rendered.yaml
if grep -q '__[A-Z_]*__' /tmp/kong.rendered.yaml; then
  echo "marcador sem valor no kong.yaml" >&2
  exit 1
fi
export KONG_DECLARATIVE_CONFIG=/tmp/kong.rendered.yaml
exec /docker-entrypoint.sh kong docker-start
