# Architecture Decision Records

Formato: Contexto, Decisão, Consequências e Alternativas. Status: Aceito, salvo indicação.

| ADR | Decisão |
| --- | --- |
| [0001](0001-mapa-de-servicos.md) | Mapa de serviços: api-gateway, messaging-gateway, media-processor, booking-agent, servidor MCP em Go e painel |
| [0002](0002-anti-corruption-layer.md) | Anti-Corruption Layer para a Cloud API e para o SaaS, com testes de contrato |
| [0003](0003-escopo-fechado-e-recusas.md) | Cloud API oficial como padrão (emenda: Whatsmiau opcional, ADR 0010) e escopo fechado em aulas e reservas, com recusa por classificador determinístico + LLM |
| [0004](0004-transferencia-para-humano.md) | Transferência para humano por pedido, tema sensível ou falha repetida; bot silencia |
| [0005](0005-idempotencia.md) | Idempotência pelo id da mensagem no webhook (Redis) e na Conversa |
| [0006](0006-mensageria-rabbitmq.md) | RabbitMQ com exchange topic, filas quorum, retry com TTL e DLQ por consumidor |
| [0007](0007-infraestrutura-local-e-servicos-emulados.md) | Infraestrutura local com Docker, WireMock no lugar da Cloud API e do SaaS, MinIO para áudio |
| [0008](0008-agente-langgraph-como-adapter.md) | Agente LangGraph como adapter de aplicação: LLM não chama ferramentas, saída validada por schema e citação garantida por código |
| [0009](0009-vinculo-telefone-aluno-conta-de-servico.md) | Vínculo telefone → aluno por opt-in e conta de serviço por estúdio com delegação restrita (sem token exchange com impersonation) |
| [0010](0010-messaging-gateway-e-provedores-de-whatsapp.md) | Messaging-gateway: porta `MessagingProvider`, provedores Cloud API e Whatsmiau escolhidos por estúdio, riscos do Whatsmiau e quando usar cada um |
| [0011](0011-media-processor.md) | Media-processor: valida, guarda no S3, miniatura, transcrição e evento `MediaProcessed` |
| [0012](0012-api-gateway-kong.md) | API Gateway com Kong DB-less: webhooks sem JWT, painel com JWT, rate limit |
