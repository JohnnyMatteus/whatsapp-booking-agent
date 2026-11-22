# Alvos padronizados do ambiente local. `make help` lista todos.
COMPOSE := docker compose
PROFILES := --profile core --profile observability

.PHONY: help network install up up-llm up-portfolio down logs ps seed notify lint test test-integration build clean

help: ## Lista os alvos
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-17s %s\n", $$1, $$2}'

network: ## Cria a rede compartilhada portfolio-net (idempotente)
	@docker network inspect portfolio-net >/dev/null 2>&1 || docker network create portfolio-net

install: ## Dependências locais (pnpm, Go e venv do worker Python)
	pnpm install --frozen-lockfile
	cd services/saas-mcp-server && go mod download
	$(MAKE) -C services/transcription-worker install

up: ## Sobe serviços, infraestrutura, mocks e observabilidade
	$(COMPOSE) $(PROFILES) up -d --build --wait

up-llm: ## Sobe o Ollama e baixa o modelo do LLM_MODEL
	$(COMPOSE) --profile llm up -d --wait ollama
	$(COMPOSE) --profile llm exec ollama ollama pull $${LLM_MODEL:-qwen2.5:3b-instruct}

up-portfolio: network ## Sobe o núcleo ligado ao saas-multitenant real pela portfolio-net
	$(COMPOSE) -f docker-compose.yml -f docker-compose.portfolio.yml --profile core up -d --build --wait

down: ## Para os contêineres (mantém volumes)
	$(COMPOSE) $(PROFILES) --profile llm --profile tools down

logs: ## Acompanha os logs
	$(COMPOSE) $(PROFILES) logs -f --tail=100

ps: ## Estado dos serviços
	$(COMPOSE) $(PROFILES) ps

seed: ## Envia ao webhook uma mensagem de exemplo assinada (TEXT="...")
	./scripts/seed-webhook.sh "$${TEXT:-Quais horários tem amanhã?}"

notify: ## Pede um aviso por template (KIND=reminder|promotion, CONTACT, SESSION, DATE=AAAA-MM-DD)
	./scripts/notify.sh

lint: ## Lint e typecheck de todos os serviços
	pnpm lint && pnpm typecheck
	$(MAKE) -C services/saas-mcp-server lint
	$(MAKE) -C services/transcription-worker lint

test: ## Testes unitários e de contrato (rápidos, sem Docker)
	pnpm test
	$(MAKE) -C services/saas-mcp-server test
	$(MAKE) -C services/transcription-worker test

test-integration: ## Testes com Redis e RabbitMQ reais via testcontainers (roda no CI)
	pnpm --filter @wba/whatsapp-gateway test:integration
	pnpm --filter @wba/booking-agent test:integration

build: ## Bundles Node, painel e binário Go
	pnpm build
	$(MAKE) -C services/saas-mcp-server build

clean: ## Remove contêineres, volumes e artefatos de build
	$(COMPOSE) $(PROFILES) --profile llm --profile tools down -v --remove-orphans
	rm -rf services/booking-agent/dist services/whatsapp-gateway/dist web/dist services/saas-mcp-server/bin
