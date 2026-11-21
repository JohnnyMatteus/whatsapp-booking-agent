# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório. Uma imagem, dois processos (webhook e sender; ADR 0001).
FROM node:22.21.1-alpine3.22 AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools ./tools
COPY packages ./packages
COPY services/whatsapp-gateway ./services/whatsapp-gateway
RUN pnpm install --frozen-lockfile --filter "@wba/whatsapp-gateway..." && pnpm --filter @wba/whatsapp-gateway build

FROM node:22.21.1-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/whatsapp-gateway/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main-webhook.js"]
