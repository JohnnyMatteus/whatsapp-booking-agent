# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório (o serviço usa pacotes do workspace).
FROM node:22.21.1-alpine3.22 AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools ./tools
COPY packages ./packages
COPY services/booking-agent ./services/booking-agent
RUN pnpm install --frozen-lockfile --filter "@wba/booking-agent..." && pnpm --filter @wba/booking-agent build

# O bundle do esbuild já contém as dependências: a imagem final leva só dist/.
FROM node:22.21.1-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/booking-agent/dist ./dist
USER node
EXPOSE 8081
CMD ["node", "--enable-source-maps", "dist/main.js"]
