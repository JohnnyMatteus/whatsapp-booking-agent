# ADR 0007: Infraestrutura local e serviços emulados

**Status:** Aceito

## Contexto

O ambiente local precisa subir o sistema inteiro sem conta na Meta, sem o SaaS rodando e sem LLM pago, e os testes nunca podem chamar serviços reais na internet.

## Decisão

- `docker-compose.yml` com profiles: `core` (serviços, RabbitMQ, Redis, MinIO, mocks), `observability` (Prometheus, Jaeger, Grafana), `llm` (Ollama) e `tools` (cliente do MinIO). Imagens com versão fixada, healthcheck em toda a infraestrutura, `depends_on` por saúde, volumes e rede nomeados, variáveis em `.env.example`.
- **WireMock no lugar da Cloud API** (`cloud-api-mock`): envio de mensagens (com um número que simula erro 131026) e download de mídia. A URL base da Cloud API é variável de ambiente: o mesmo código fala com `graph.facebook.com` em produção.
- **WireMock no lugar do SaaS** (`saas-mock`), com datas relativas a hoje, para rodar sem o `saas-multitenant`. O override `docker-compose.portfolio.yml` liga o servidor MCP ao SaaS real pela rede externa `portfolio-net` (`make network`).
- **MinIO** como S3 para os áudios (bucket criado por `minio-init`, com expiração de 30 dias). O worker usa boto3 com endpoint configurável, então funciona na AWS trocando variáveis. LocalStack não entra: o domínio só usa object storage.
- **Redis** para idempotência do webhook, estado da conversa e fila de atendimento.
- **Ollama** opcional para o LLM local; qualquer API compatível com OpenAI serve.
- `Makefile` com `up`, `down`, `logs`, `ps`, `seed` (envia um webhook assinado como a Meta), `test`, `test-integration`, `clean` e `network`.
- Localmente rodam só lint, typecheck e testes unitários e de contrato. Integração (testcontainers) e build das imagens rodam no CI.

## Consequências

- Um `make up && make seed` exercita webhook, fila, agente, servidor MCP e sender contra os mocks.
- Os mocks podem divergir da API real; os testes de contrato com payloads reais anonimizados são a referência, e os mocks reutilizam os mesmos formatos.

## Alternativas

- **Sandbox de teste da Meta**: exige conta e número, e não serve para CI.
- **LocalStack para S3**: funcionaria, mas é mais pesado que o MinIO para um único bucket.
