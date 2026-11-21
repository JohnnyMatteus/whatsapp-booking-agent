# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório.
FROM node:22.21.1-alpine3.22 AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web ./web
RUN pnpm install --frozen-lockfile --filter "@wba/web..." && pnpm --filter @wba/web build

# nginx serve o SPA e faz proxy de /api para o booking-agent, injetando o token do painel
# do lado do servidor (o token não vai para o navegador).
FROM nginx:1.27.5-alpine
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 8080
