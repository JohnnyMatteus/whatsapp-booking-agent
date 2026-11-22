# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório (o serviço usa pacotes do workspace).
FROM node:22.21.1-alpine3.22 AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
# O workspace inteiro entra no estágio de build (o .dockerignore tira node_modules e artefatos):
# o lockfile é um só e o install congelado precisa de todos os projetos.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @wba/booking-agent build

# O bundle do esbuild já contém as dependências: a imagem final leva só dist/.
FROM node:22.21.1-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/booking-agent/dist ./dist
# UID numérico: o kubelet recusa runAsNonRoot com usuário só por nome. 1000 é o usuário node da imagem.
USER 1000:1000
EXPOSE 8081
CMD ["node", "--enable-source-maps", "dist/main.js"]
