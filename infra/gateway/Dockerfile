# api-gateway: Kong OSS em modo DB-less com a configuração declarativa embutida (ADR 0012).
# Contexto de build: infra/gateway.
FROM kong:3.9.1

COPY kong.yaml /kong/declarative/kong.yaml
COPY entrypoint.sh /kong/entrypoint.sh
COPY fetch-realm-key.lua /kong/fetch-realm-key.lua

ENV KONG_PREFIX=/tmp/kong \
    KONG_DATABASE=off \
    KONG_PROXY_LISTEN="0.0.0.0:8000" \
    KONG_ADMIN_LISTEN="127.0.0.1:8001" \
    KONG_STATUS_LISTEN="0.0.0.0:8100" \
    KONG_PROXY_ACCESS_LOG=off \
    KONG_PROXY_ERROR_LOG=/dev/stderr \
    KONG_ADMIN_ACCESS_LOG=off \
    KONG_HEADERS="X-Kong-Request-Id"

# UID numérico arbitrário e prefixo do Kong em /tmp: roda sem root e com o sistema de arquivos somente leitura
# (em Kubernetes /tmp é emptyDir). O kubelet recusa runAsNonRoot com usuário só por nome.
USER 10001:10001
ENTRYPOINT ["/kong/entrypoint.sh"]
