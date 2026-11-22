#!/bin/sh
# Renderiza o kong.yaml com a configuração do ambiente e inicia o Kong.
#   OIDC_ISSUER               emissor (iss) dos tokens do painel
#   OIDC_REALM_URL            URL interna do realm (ex.: http://keycloak:8080/realms/wba): a chave pública é
#                             lida de lá ao subir, com tentativas, e o Kong não sobe sem ela
#   PANEL_JWT_PUBLIC_KEY_FILE alternativa: chave pública RSA (PEM) já em arquivo (CI e testes)
# RENDER_ONLY=1 só renderiza (usado pelo CI para `kong config parse`).
set -eu
: "${OIDC_ISSUER:?defina OIDC_ISSUER}"
OUT="${KONG_RENDERED_PATH:-/tmp/kong.rendered.yaml}"

KEY_FILE="${PANEL_JWT_PUBLIC_KEY_FILE:-}"
if [ -z "$KEY_FILE" ]; then
  : "${OIDC_REALM_URL:?defina OIDC_REALM_URL ou PANEL_JWT_PUBLIC_KEY_FILE}"
  KEY_FILE=/tmp/realm-public-key.pem
  attempt=1
  until resty /kong/fetch-realm-key.lua "$OIDC_REALM_URL" > "$KEY_FILE" 2> /tmp/realm-key.err; do
    if [ "$attempt" -ge "${KEY_FETCH_ATTEMPTS:-30}" ]; then
      cat /tmp/realm-key.err >&2
      echo "chave pública do realm indisponível após $attempt tentativas" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
fi

# Falha antes de renderizar: arquivo ausente, ilegível, vazio ou que não é uma chave pública PEM.
if [ ! -r "$KEY_FILE" ] || [ ! -s "$KEY_FILE" ] \
  || [ "$(head -n 1 "$KEY_FILE")" != "-----BEGIN PUBLIC KEY-----" ] \
  || [ "$(tail -n 1 "$KEY_FILE")" != "-----END PUBLIC KEY-----" ]; then
  echo "chave pública do painel ausente, vazia ou fora do formato PEM" >&2
  exit 1
fi

# A chave entra indentada como o marcador, para continuar sendo um bloco YAML.
sed -e "s|__OIDC_ISSUER__|${OIDC_ISSUER}|g" /kong/declarative/kong.yaml |
  awk -v keyfile="$KEY_FILE" '
    /__PANEL_JWT_PUBLIC_KEY__/ { match($0, /^ */); pad = substr($0, 1, RLENGTH); while ((getline line < keyfile) > 0) print pad line; next }
    { print }' > "$OUT"
if grep -q '__[A-Z_]*__' "$OUT"; then
  echo "marcador sem valor no kong.yaml" >&2
  exit 1
fi
[ -z "${RENDER_ONLY:-}" ] || exit 0
export KONG_DECLARATIVE_CONFIG="$OUT"
exec /docker-entrypoint.sh kong docker-start
