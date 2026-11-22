# ADR 0001: Mapa de serviços

**Status:** Aceito. Atualizado pelos ADRs 0010 (messaging-gateway), 0011 (media-processor) e 0012 (api-gateway); a tabela abaixo é o mapa vigente.

## Contexto

O sistema tem quatro cargas de trabalho com perfis diferentes: receber o webhook da Meta (precisa responder em milissegundos e aguentar rajadas), conversar com o aluno (espera LLM e a API do SaaS, segundos por mensagem), transcrever áudio (CPU pesada e intermitente) e enviar respostas à Cloud API (limite de taxa, retry). O plano do projeto sugere um mapa com `webhook-gateway`, `booking-agent`, `saas-mcp-server`, `transcription-worker`, `sender` e `web`, e deixa em aberto se o sender fica dentro do gateway. O padrão do portfólio é Clean Architecture + Hexagonal + DDD.

## Decisão

| Serviço | Linguagem | Responsabilidade |
| --- | --- | --- |
| `infra/gateway` (api-gateway) | Kong OSS DB-less | Única entrada pública: roteia webhooks (sem JWT) e a API do painel (JWT), rate limit. ADR 0012. |
| `services/messaging-gateway` | TypeScript (Fastify) | Serviço de integrações. Porta `MessagingProvider` com os provedores de WhatsApp (Cloud API e Whatsmiau, por estúdio), ACL de cada um, webhook, status de entrega, mídia e sender (retry e DLQ). Dois processos na mesma imagem: **webhook** e **sender**. ADR 0010. |
| `services/media-processor` | Python | Valida, guarda no MinIO/S3, gera miniatura e transcreve áudio (faster-whisper local atrás de porta). ADR 0011. |
| `services/booking-agent` | TypeScript (LangGraph.js) | Domínio de Agendamento, casos de uso, agente como adapter de aplicação, API do painel. Fala só com o messaging-gateway, por fila. |
| `services/saas-mcp-server` | Go (SDK oficial `modelcontextprotocol/go-sdk`) | As quatro ferramentas MCP e a ACL do SaaS. |
| `web/` | Vue 3 + Vuetify + TanStack Query | Painel do estúdio (fila de atendimento nesta rodada). |
| `packages/contracts`, `packages/messaging`, `packages/observability` | TypeScript | Linguagem publicada da fila, adaptador RabbitMQ e observabilidade comuns aos serviços Node. |

O serviço de integrações começou como `whatsapp-gateway` e virou `messaging-gateway` quando ganhou o segundo provedor: é a fronteira com os provedores nos **dois sentidos**, e a ACL de cada provedor fica inteira num lugar só.

## Consequências

- A ACL de cada provedor não se duplica: entrada e saída compartilham os tipos do provedor e o protocolo de ids interativos (`v1:bk:<aula>`).
- Webhook e sender escalam separadamente (processos distintos, mesma imagem).
- Três runtimes (Node, Go, Python) mais o Kong aumentam o custo de manutenção e de CI. Cada um se justifica: Go pelo SDK MCP oficial e pela imagem estática; Python pelo ecossistema de transcrição.
- Os serviços Node compartilham pacotes do workspace; o build usa esbuild para gerar um arquivo por entrypoint, e a imagem final não leva `node_modules`.

## Alternativas

- **Sender como serviço próprio**: separaria o deploy, mas duplicaria a ACL da Cloud API ou exigiria um pacote só para ela. Pode ser extraído depois sem mudar contratos (a fila já é a fronteira).
- **Monólito modular**: simples de operar, mas o webhook ficaria preso ao tempo do LLM e uma rajada de áudios competiria com o atendimento.
- **Servidor MCP em TypeScript**: um runtime a menos, mas o portfólio já usa Go para servidores MCP e a separação deixa a ACL do SaaS reutilizável por outros clientes MCP.
