# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório.
FROM node:22.21.1-alpine3.22 AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
# O workspace inteiro entra no estágio de build (o .dockerignore tira node_modules e artefatos):
# o lockfile é um só e o install congelado precisa de todos os projetos.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @wba/web build

# nginx serve o SPA e faz proxy de /api para o api-gateway, injetando o JWT do painel
# do lado do servidor (o token não vai para o navegador). O gateway valida o JWT.
FROM nginx:1.27.5-alpine
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 8080
