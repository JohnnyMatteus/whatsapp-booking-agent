# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório.
FROM node:22.21.1-alpine3.22 AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
# O workspace inteiro entra no estágio de build (o .dockerignore tira node_modules e artefatos):
# o lockfile é um só e o install congelado precisa de todos os projetos.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @wba/web build

# nginx serve o SPA e faz proxy de /api para o api-gateway, repassando o JWT do atendente que o
# navegador obteve no Keycloak. Nenhum token fica no servidor do painel.
FROM nginx:1.27.5-alpine
# Sem root, com UID numérico (101 é o usuário nginx da imagem): o pid vai para /tmp e o cache e o conf.d (onde o
# entrypoint grava o default.conf renderizado) ficam graváveis por esse usuário. Em Kubernetes, com o sistema de
# arquivos somente leitura, esses três caminhos são emptyDir (deploy/helm/wba).
RUN sed -i -e '/^user /d' -e 's,/var/run/nginx.pid,/tmp/nginx.pid,' -e 's,/run/nginx.pid,/tmp/nginx.pid,' /etc/nginx/nginx.conf \
 && chown -R 101:0 /var/cache/nginx /etc/nginx/conf.d && chmod -R g+w /var/cache/nginx /etc/nginx/conf.d
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
