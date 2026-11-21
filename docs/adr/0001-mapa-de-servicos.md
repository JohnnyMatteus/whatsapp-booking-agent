# ADR 0001: Mapa de serviços

**Status:** Aceito

## Contexto

O sistema tem quatro cargas de trabalho com perfis diferentes: receber o webhook da Meta (precisa responder em milissegundos e aguentar rajadas), conversar com o aluno (espera LLM e a API do SaaS, segundos por mensagem), transcrever áudio (CPU pesada e intermitente) e enviar respostas à Cloud API (limite de taxa, retry). O plano do projeto sugere um mapa com `webhook-gateway`, `booking-agent`, `saas-mcp-server`, `transcription-worker`, `sender` e `web`, e deixa em aberto se o sender fica dentro do gateway. O padrão do portfólio é Clean Architecture + Hexagonal + DDD.

## Decisão

| Serviço | Linguagem | Responsabilidade |
| --- | --- | --- |
| `services/whatsapp-gateway` | TypeScript (Fastify) | Fronteira com a Meta. Dois processos na mesma imagem: **webhook** (assinatura, idempotência, ACL de entrada, publicação) e **sender** (ACL de saída, envio, retry e DLQ). |
| `services/booking-agent` | TypeScript (LangGraph.js) | Domínio de Agendamento, casos de uso, agente como adapter de aplicação, API do painel. |
| `services/saas-mcp-server` | Go (SDK oficial `modelcontextprotocol/go-sdk`) | As quatro ferramentas MCP e a ACL do SaaS. |
| `services/transcription-worker` | Python | Transcrição local (faster-whisper) atrás de porta. |
| `web/` | Vue 3 + Vuetify + TanStack Query | Painel do estúdio (fila de atendimento nesta rodada). |
| `packages/contracts`, `packages/messaging`, `packages/observability` | TypeScript | Linguagem publicada da fila, adaptador RabbitMQ e observabilidade comuns aos serviços Node. |

O nome `whatsapp-gateway` (em vez de `webhook-gateway`) reflete que o serviço é a fronteira com a Meta nos **dois sentidos**: a ACL da Cloud API fica inteira num lugar só.

## Consequências

- A ACL do WhatsApp não se duplica: entrada e saída compartilham os tipos da Meta e o protocolo de ids interativos (`v1:bk:<aula>`).
- Webhook e sender escalam separadamente (processos distintos, mesma imagem).
- Três runtimes (Node, Go, Python) aumentam o custo de manutenção e de CI. Cada um se justifica: Go pelo SDK MCP oficial e pela imagem estática; Python pelo ecossistema de transcrição.
- Os serviços Node compartilham pacotes do workspace; o build usa esbuild para gerar um arquivo por entrypoint, e a imagem final não leva `node_modules`.

## Alternativas

- **Sender como serviço próprio**: separaria o deploy, mas duplicaria a ACL da Cloud API ou exigiria um pacote só para ela. Pode ser extraído depois sem mudar contratos (a fila já é a fronteira).
- **Monólito modular**: simples de operar, mas o webhook ficaria preso ao tempo do LLM e uma rajada de áudios competiria com o atendimento.
- **Servidor MCP em TypeScript**: um runtime a menos, mas o portfólio já usa Go para servidores MCP e a separação deixa a ACL do SaaS reutilizável por outros clientes MCP.
