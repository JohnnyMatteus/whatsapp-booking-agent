# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório. Uma imagem, dois processos (webhook e sender; ADR 0001 e 0010).
FROM node:22.21.1-alpine3.22 AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
# O workspace inteiro entra no estágio de build (o .dockerignore tira node_modules e artefatos):
# o lockfile é um só e o install congelado precisa de todos os projetos.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @wba/messaging-gateway build

FROM node:22.21.1-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/messaging-gateway/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main-webhook.js"]
