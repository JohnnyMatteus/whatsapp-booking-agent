# CLAUDE.md

Guia para sessões de agente neste repositório.

## Visão

Agente de agendamento via WhatsApp para alunos de estúdios de yoga e pilates (domínio fictício). Consulta, reserva, cancela e põe na lista de espera pela API do `saas-multitenant`, com escopo fechado em aulas e reservas e transferência para humano. Design: `docs/design-doc.md`. Decisões: `docs/adr/`. Núcleo explicado em `docs/roteiros/`.

## Regras inegociáveis

- **WhatsApp Cloud API oficial é o padrão.** O Whatsmiau é opt-in por estúdio (ADR 0010, com os riscos de banimento e de violar os termos); nenhuma biblioteca de WhatsApp Web entra nos nossos serviços. O domínio e o booking-agent nunca sabem qual provedor atende o estúdio: só `@wba/contracts` e a porta `MessagingProvider`.
- **Escopo fechado** em aulas e reservas (política da Meta desde 15/01/2026). Pedido fora do escopo recebe recusa; o LLM não reverte a política determinística (`scope-policy.ts`).
- **O bot só cita horários vindos das ferramentas.** Horário em resposta é sempre renderizado por `format.ts` a partir de um `OfferedSlot`; o texto do LLM não pode ter data nem hora (`citation-guard.ts`). Não remova nem afrouxe o guard sem ADR.
- **O LLM não chama ferramentas** e não preenche `estudio`/`contato`; toda saída de LLM passa por schema Zod com um retry. Testes usam `FakeLlmClient`.
- **Nenhum tipo da Meta fora de `services/messaging-gateway/src/providers/cloud-api/acl/cloud-api-types.ts`, nenhum tipo do Whatsmiau fora de `.../providers/whatsmiau/acl/whatsmiau-types.ts`** e nenhum tipo do SaaS fora de `services/saas-mcp-server/internal/adapters/saas`. Tipo novo exige fixture e teste de contrato.
- **Domínio sem framework**: `services/booking-agent/src/domain` não importa LangGraph, amqplib, ioredis, fastify, zod, MCP nem `@wba/contracts` (o ESLint bloqueia). O domínio recebe `now` por parâmetro.
- **Dados pessoais**: telefone e texto do aluno nunca em log, span ou mensagem de erro; erros não incluem corpo de resposta do provedor de WhatsApp, do SaaS ou do LLM.
- Domínio 100% fictício, e-mails só `@example.com`, segredos só `dev-only-*` em exemplos. Docs em português do Brasil; identificadores em inglês (exceto o vocabulário das ferramentas MCP, que é em português por contrato).
- Commits em Conventional Commits, mensagem via `git commit -F <arquivo>`, terminando com a linha `Co-Authored-By`.

## Comandos

```bash
make install           # pnpm, Go e venv do media-processor
make lint              # ESLint + tsc/vue-tsc + gofmt/go vet + ruff/mypy
make test              # unitários e de contrato (rápidos, sem Docker)
make test-integration  # testcontainers (deixe para o CI)
make build             # bundles Node, painel e binário Go
make up / make down / make logs / make ps / make seed / make clean
make up-whatsmiau / make seed-whatsmiau / make panel-jwt / make gateway-smoke
docker compose --profile core --profile observability --profile llm --profile tools --profile whatsmiau config -q
```

Por serviço: `pnpm --filter @wba/<pacote> test|typecheck|build`, `make -C services/saas-mcp-server test`, `make -C services/media-processor test`.

Localmente rode só lint, typecheck e testes unitários. Não suba a stack inteira nem rode integração para validar mudança pequena.

## Estrutura

```
packages/contracts        linguagem publicada da fila (Zod) e topologia do RabbitMQ
packages/messaging        adaptador RabbitMQ (confirms, ack manual, retry com TTL, DLQ)
packages/observability    pino com redação, Prometheus, OpenTelemetry
infra/gateway             api-gateway Kong DB-less (kong.yaml, entrypoint, smoke), ADR 0012
services/messaging-gateway  porta MessagingProvider (src/ports.ts), src/providers/{cloud-api,whatsmiau} (ACL, cliente, provedor), src/webhook, src/sender, API interna de mídia
services/booking-agent    src/domain, src/application (portas e casos de uso), src/agent (grafo LangGraph), src/adapters
services/saas-mcp-server  internal/scheduling (núcleo), internal/adapters/saas (ACL), internal/mcpserver, cmd/
services/media-processor  src/media_processor (domínio, portas, caso de uso ProcessMedia, adaptadores: gateway, S3, Pillow)
web/                      painel Vue 3 + Vuetify + TanStack Query
infra/                    WireMock (Cloud API, Whatsmiau e SaaS), Prometheus, nginx, MinIO, Grafana
docs/                     design doc, ADRs, roteiros
```

## Fluxo de trabalho

1. Mudança de arquitetura, contrato ou política (escopo, transferência, idempotência) começa por um ADR.
2. Domínio e regras críticas com TDD: escreva o teste em `tests/domain` ou `tests/agent` primeiro.
3. Mudança de contrato da fila: compatível ou nova `version`, com teste em `packages/contracts`.
4. Payload novo de um provedor de WhatsApp ou do SaaS: adicione a fixture anonimizada e o teste de contrato antes do tradutor.
5. Rode `make lint && make test` antes de commitar; o CI precisa passar de primeira.
6. Atualize README, design doc e roteiros quando o comportamento mudar; registre o que ficar para depois em Próximos passos.
