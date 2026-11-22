# ADR 0007: Infraestrutura local e serviços emulados

**Status:** Aceito

## Contexto

O ambiente local precisa subir o sistema inteiro sem conta na Meta, sem o SaaS rodando e sem LLM pago, e os testes nunca podem chamar serviços reais na internet.

## Decisão

- `docker-compose.yml` com profiles: `core` (serviços, RabbitMQ, Redis, LocalStack, mocks), `observability` (Prometheus, Jaeger, Grafana) e `llm` (Ollama). Imagens com versão fixada, healthcheck em toda a infraestrutura, `depends_on` por saúde, volumes e rede nomeados, variáveis em `.env.example`.
- **WireMock no lugar da Cloud API** (`cloud-api-mock`): envio de mensagens (com um número que simula erro 131026) e download de mídia. A URL base da Cloud API é variável de ambiente: o mesmo código fala com `graph.facebook.com` em produção.
- **WireMock no lugar do SaaS** (`saas-mock`), com datas relativas a hoje, para rodar sem o `saas-multitenant`. O override `docker-compose.portfolio.yml` liga o servidor MCP ao SaaS real pela rede externa `portfolio-net` (`make network`).
- **LocalStack** (`localstack/localstack:4.4.0`, só o serviço `s3`) como S3 para os áudios e miniaturas. O bucket e a expiração de 30 dias são criados por um script de init (`infra/localstack/init-s3.sh`) que o LocalStack executa quando fica pronto; o healthcheck só passa depois dele. O worker usa boto3 com endpoint configurável e endereçamento por caminho (path-style), então funciona na AWS trocando variáveis. Para inspecionar: `docker compose exec localstack awslocal s3 ls --recursive s3://wba-media`.
- **Redis** para idempotência do webhook, estado da conversa e fila de atendimento.
- **Ollama** opcional para o LLM local; qualquer API compatível com OpenAI serve.
- `Makefile` com `up`, `down`, `logs`, `ps`, `seed` (envia um webhook assinado como a Meta), `test`, `test-integration`, `clean` e `network`.
- Localmente rodam só lint, typecheck e testes unitários e de contrato. Integração (testcontainers) e build das imagens rodam no CI.

## Consequências

- Um `make up && make seed` exercita webhook, fila, agente, servidor MCP e sender contra os mocks.
- Os mocks podem divergir da API real; os testes de contrato com payloads reais anonimizados são a referência, e os mocks reutilizam os mesmos formatos.

## Alternativas

- **Sandbox de teste da Meta**: exige conta e número, e não serve para CI.
- **MinIO** foi o S3 local da primeira versão, mas as imagens `minio/minio` e `minio/mc` deixaram de ser publicadas (o pull falha no Docker Hub e no quay), então o ambiente só subiria com cache local. Trocado pelo LocalStack, mais pesado, mas com imagem e tag verificadas.
