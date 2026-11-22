# Alvos padronizados do ambiente local. `make help` lista todos.
COMPOSE := docker compose
PROFILES := --profile core --profile observability

.PHONY: help network install up up-llm up-whatsmiau seed-whatsmiau panel-token gateway-smoke up-portfolio down logs ps seed notify lint test test-integration build clean

help: ## Lista os alvos
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-17s %s\n", $$1, $$2}'

network: ## Cria a rede compartilhada portfolio-net (idempotente)
	@docker network inspect portfolio-net >/dev/null 2>&1 || docker network create portfolio-net

install: ## Dependências locais (pnpm, Go e venv do media-processor (Python))
	pnpm install --frozen-lockfile
	cd services/saas-mcp-server && go mod download
	$(MAKE) -C services/media-processor install

up: ## Sobe serviços, infraestrutura, mocks e observabilidade
	$(COMPOSE) $(PROFILES) up -d --build --wait

up-llm: ## Sobe o Ollama e baixa o modelo do LLM_MODEL
	$(COMPOSE) --profile llm up -d --wait ollama
	$(COMPOSE) --profile llm exec ollama ollama pull $${LLM_MODEL:-qwen2.5:3b-instruct}

up-whatsmiau: ## Sobe com o estudio-sol atendido pelo Whatsmiau (mock); o estudio-lotus segue na Cloud API
	TENANT_CHANNELS='{"estudio-lotus":{"provider":"cloud-api","phoneNumberId":"100000000000001"},"estudio-sol":{"provider":"whatsmiau","instance":"estudio-sol"}}' \
		$(COMPOSE) $(PROFILES) --profile whatsmiau up -d --build --wait

up-portfolio: network ## Sobe o núcleo ligado ao saas-multitenant real pela portfolio-net
	$(COMPOSE) -f docker-compose.yml -f docker-compose.portfolio.yml --profile core up -d --build --wait

down: ## Para os contêineres (mantém volumes)
	$(COMPOSE) $(PROFILES) --profile llm down

logs: ## Acompanha os logs
	$(COMPOSE) $(PROFILES) logs -f --tail=100

ps: ## Estado dos serviços
	$(COMPOSE) $(PROFILES) ps

seed: ## Envia ao webhook uma mensagem de exemplo assinada (TEXT="...")
	./scripts/seed-webhook.sh "$${TEXT:-Quais horários tem amanhã?}"

seed-whatsmiau: ## Envia ao webhook do Whatsmiau uma mensagem de exemplo com o segredo da instância (TEXT="...")
	./scripts/seed-whatsmiau.sh "$${TEXT:-Quais horários tem amanhã?}"

panel-token: ## Access token de desenvolvimento do Keycloak (USER_NAME=ana.lotus, bia.lotus ou caio.sol)
	./scripts/panel-token.sh $${USER_NAME:-ana.lotus}

gateway-smoke: ## Smoke do api-gateway de que você tem o par de chaves (PANEL_JWT_PRIVATE_KEY_FILE); o CI usa um descartável
	./infra/gateway/smoke.sh http://127.0.0.1:$${GATEWAY_PORT:-8000}

notify: ## Pede um aviso por template (KIND=reminder|promotion, CONTACT, SESSION, DATE=AAAA-MM-DD)
	./scripts/notify.sh

lint: ## Lint e typecheck de todos os serviços
	pnpm lint && pnpm typecheck
	$(MAKE) -C services/saas-mcp-server lint
	$(MAKE) -C services/media-processor lint

test: ## Testes unitários e de contrato (rápidos, sem Docker)
	pnpm test
	$(MAKE) -C services/saas-mcp-server test
	$(MAKE) -C services/media-processor test

test-integration: ## Testes com Redis e RabbitMQ reais via testcontainers (roda no CI)
	pnpm --filter @wba/messaging-gateway test:integration
	pnpm --filter @wba/booking-agent test:integration

build: ## Bundles Node, painel e binário Go
	pnpm build
	$(MAKE) -C services/saas-mcp-server build

clean: ## Remove contêineres, volumes e artefatos de build
	$(COMPOSE) $(PROFILES) --profile llm down -v --remove-orphans
	rm -rf services/booking-agent/dist services/messaging-gateway/dist web/dist services/saas-mcp-server/bin
