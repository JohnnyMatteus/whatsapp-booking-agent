# Alvos do servidor MCP em Go (usados localmente e pelo CI).
.PHONY: lint test build

lint: ## gofmt + go vet
	@unformatted="$$(gofmt -l .)"; if [ -n "$$unformatted" ]; then echo "rode gofmt -w em: $$unformatted"; exit 1; fi
	go vet ./...

test: ## Testes unitários e de contrato (SaaS falso via httptest)
	go test -race -count=1 ./...

build: ## Binário estático em bin/
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/saas-mcp-server ./cmd/saas-mcp-server
