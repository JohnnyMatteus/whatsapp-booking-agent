# Design doc: agente de agendamento via WhatsApp

| | |
| --- | --- |
| Status | Implementado; o que falta está na seção 12 |
| Autor | Johnny Santos |
| Última revisão | 2026-11-21 |
| Depende de | [saas-multitenant](https://github.com/JohnnyMatteus/saas-multitenant) (API REST v1 de agenda) |

## 1. Contexto

Os estúdios de yoga e pilates que usam o SaaS de agendamento (projeto `saas-multitenant`) recebem pelo WhatsApp boa parte dos pedidos dos alunos: "tem aula amanhã cedo?", "me tira da aula de quinta", "lotou? me coloca na fila". A recepção responde à mão, copia o horário da grade do SaaS e faz a reserva por lá. Nos horários de pico, a resposta demora e a vaga vai para quem pediu depois.

Este projeto coloca um agente no número de WhatsApp Business do estúdio. Ele mostra horários, reserva, cancela e coloca na lista de espera usando a própria API do SaaS, e passa a conversa para uma pessoa quando o assunto sai da agenda.

Duas restrições externas moldam o desenho:

1. **WhatsApp Cloud API oficial por padrão.** Nada de bibliotecas que automatizam o WhatsApp Web dentro dos nossos serviços: elas violam os termos da Meta e derrubam o número. O estúdio pode optar, por configuração, pelo **Whatsmiau** (servidor externo não oficial, alternativo à Meta), ciente dos riscos de banimento e de violação dos termos; ver o [ADR 0010](adr/0010-messaging-gateway-e-provedores-de-whatsapp.md), que também diz quando usar cada provedor.
2. **Desde 15/01/2026 a política da Meta proíbe chatbots de uso geral na plataforma.** O agente precisa ter escopo fechado e demonstrável: aulas e reservas. Pedido fora disso recebe uma recusa educada.

## 2. Objetivos e não-objetivos

**Objetivos**

- O aluno consulta horários, reserva, cancela e entra na lista de espera pelo WhatsApp, em linguagem natural, botões, listas, Flows ou áudio.
- O bot **só cita horários que vieram das ferramentas** (a API do SaaS), com garantia por código e teste que prova.
- Escopo fechado com recusa educada, decidido por um classificador determinístico mais o LLM, sem que o LLM consiga reverter o determinístico.
- Transferência para humano por pedido explícito, por falha repetida ou por tema sensível. Transferida, a conversa vai para a fila de atendimento e o bot para de responder.
- Webhook autêntico (assinatura da Meta ou segredo do Whatsmiau) e idempotente pelo id da mensagem.
- Nenhum tipo de provedor ou do SaaS dentro do domínio (Anti-Corruption Layer por provedor e no SaaS); o domínio e o booking-agent não sabem qual provedor atende o estúdio.
- Entrada única pelo api-gateway (Kong): roteamento, rate limit e JWT do painel.

**Não-objetivos**

- Pagamentos, planos, cadastro de aluno: são temas sensíveis e vão para humano.
- Mensagens proativas em massa. Só dois avisos saem sem o aluno ter escrito (lembrete de aula e vaga liberada na lista de espera), por template na Cloud API e por texto no Whatsmiau, uma vez por reserva.
- Chatbot de uso geral: o escopo é fechado (seção 1).

**Já entregue, e onde**

- Atendimento humano pelo painel: o atendente lê a conversa, responde pela fila (`reply-as-attendant.ts`, janela de 24 horas conferida) e devolve ao bot.
- Vínculo telefone → aluno por opt-in (`vincular 123456`) e conta de serviço por estúdio, sem token exchange com impersonation ([ADR 0009](adr/0009-vinculo-telefone-aluno-conta-de-servico.md)).
- Avisos por template (`notify-student.ts`, `reminder-scheduler.ts`), com a data sempre vinda da consulta à agenda.
- Login do atendente por OIDC ([ADR 0013](adr/0013-login-do-painel-oidc.md)).

## 3. Arquitetura

Clean Architecture + Hexagonal + DDD, em microsserviços, no mesmo padrão dos outros projetos do portfólio. O mapa de serviços e o motivo de cada fronteira estão no [ADR 0001](adr/0001-mapa-de-servicos.md).

```mermaid
flowchart LR
  aluno((Aluno no WhatsApp)) -- mensagem --> meta[WhatsApp Cloud API]
  aluno -. estúdio que optou .-> miau[Whatsmiau<br/>não oficial]
  meta -- webhook assinado --> kong
  miau -- webhook + segredo --> kong
  web[web · Vue 3<br/>fila de atendimento] -- JWT --> kong
  kong{{api-gateway · Kong DB-less<br/>roteamento · rate limit · JWT do painel}}
  kong -- /webhooks/* sem JWT --> webhook
  kong -- /api --> agent

  subgraph gateway[messaging-gateway · TypeScript]
    webhook[webhook<br/>autenticidade · idempotência]
    port{{porta MessagingProvider<br/>envio · webhook · status · mídia}}
    cloud[providers/cloud-api<br/>ACL da Meta]
    wm[providers/whatsmiau<br/>ACL própria]
    sender[sender<br/>retry · DLQ]
    webhook --> port
    sender --> port
    port --- cloud
    port --- wm
  end

  webhook -- comandos --> mq[(RabbitMQ<br/>wba.events)]
  webhook <--> redis[(Redis)]
  mq -- inbound.media_received --> media[media-processor · Python<br/>valida · miniatura · faster-whisper]
  media -- GET /internal/media --> webhook
  media -- original e miniatura --> s3[(S3 / LocalStack)]
  media -- inbound.message_received<br/>media.processed --> mq
  mq -- inbound.* --> agent

  subgraph agentbox[booking-agent · TypeScript]
    agent[caso de uso + domínio de Agendamento<br/>agente LangGraph como adapter]
  end

  agent <--> redis
  agent -- ferramentas MCP --> mcp[saas-mcp-server · Go<br/>ACL do SaaS]
  agent -- LLM compatível com OpenAI --> llm[(Ollama / provedor)]
  mcp -- REST v1 + JWT --> saas[saas-multitenant]
  agent -- outbound.reply_requested<br/>attendance.handoff_requested --> mq
  mq -- respostas --> sender
  cloud -- POST /messages --> meta
  wm -- POST /v1/message/send* --> miau
```

**Camadas no booking-agent** (onde está o domínio):

| Camada | Pasta | Conhece |
| --- | --- | --- |
| Domínio | `src/domain` | nada externo (o ESLint bloqueia imports de framework, fila, LLM e contratos) |
| Aplicação | `src/application` | domínio e portas (`SchedulingTools`, `ConversationRepository`, `HandoffQueue`, `OutboundPublisher`, `ConversationAgent`) |
| Agente (adapter de aplicação) | `src/agent` | LangGraph, porta do LLM, domínio |
| Adaptadores | `src/adapters` | MCP, RabbitMQ, Redis, HTTP, LLM |

### 3.1 Anti-Corruption Layer em dois pontos

Detalhes e custo no [ADR 0002](adr/0002-anti-corruption-layer.md).

1. **WhatsApp** (uma ACL por provedor em `services/messaging-gateway/src/providers/*/acl`; o Whatsmiau segue o mesmo padrão com fixtures no formato Evolution API): o payload da Cloud API (webhook, texto, áudio, interativos de lista e botão, conclusão de Flow, resposta de template, status de entrega e tipos desconhecidos) vira comandos e eventos da linguagem publicada: `MensagemRecebida` (`inbound.message_received`), `PedidoDeReserva` (`inbound.booking_requested`), `PedidoDeCancelamento` (`inbound.cancellation_requested`), pedido de lista de espera, mídia recebida (`inbound.media_received`, áudio ou imagem) e mudança de status. Na saída, a resposta neutra do domínio (texto ou opções) vira texto, botões ou lista da Cloud API, respeitando os limites da Meta. Os tipos da Meta vivem num único arquivo (`cloud-api-types.ts`) e os do Whatsmiau noutro (`whatsmiau-types.ts`). O protocolo de ids interativos (`v1:bk:<aula>`) é compartilhado: a escolha do aluno volta como o mesmo comando nos dois provedores.
2. **SaaS** (`services/saas-mcp-server/internal/adapters/saas`): `SessionResource`, `BookingResource` e `problem+json` do SaaS viram `Aula`, `Reserva` e erros de domínio com códigos estáveis. Uma segunda barreira no booking-agent (`adapters/mcp/scheduling-tools.ts`) valida a resposta das ferramentas por schema e reconstrói os agregados, reaplicando as invariantes.

## 4. Modelo de dados

### 4.1 Domínio de Agendamento (booking-agent)

Os nomes de código são em inglês; o vocabulário de negócio é o da tabela. O roteiro [modelo de domínio](roteiros/modelo-dominio-agendamento.md) explica cada invariante.

| Agregado | Classe | Invariantes principais |
| --- | --- | --- |
| Aula | `ClassSession` | fim depois do início; capacidade inteira positiva; confirmados entre 0 e a capacidade; fila só existe com aula lotada; fuso IANA válido; começou = não aceita reserva, cancelamento nem fila |
| Reserva | `Booking` | `confirmed` → `canceled`; `waitlisted` → `confirmed` (promoção) ou `canceled`; cancelada é final; cancelar vaga confirmada libera lugar |
| Lista de espera | `Waitlist` | só em aula lotada e não começada; aluno entra uma vez; quem tem vaga não entra; FIFO, a posição de quem entra é o fim da fila |
| Conversa | `Conversation` | cada mensagem processada uma vez; o aluno só escolhe entre as opções da última oferta, válida por 30 minutos; 2 falhas seguidas transferem para humano; transferida, o bot não oferece nada e só registra as mensagens; transferir é idempotente |

A política de escopo (`scope-policy.ts`) também é domínio: função pura que classifica o texto em `handoff`, `out_of_scope`, `in_scope(intenção)` ou `undecided`.

### 4.2 Linguagem publicada (fila)

Envelope versionado (`packages/contracts`): `{ id, type, version: 1, occurredAt, correlationId, payload }`. A routing key é o `type`; o `correlationId` é o id da mensagem original do WhatsApp e atravessa todos os saltos.

| type | Produtor | Consumidor | Payload (resumo) |
| --- | --- | --- | --- |
| `inbound.message_received` | messaging-gateway, media-processor | booking-agent | origem + `text` (com `transcribed`) ou `unsupported` |
| `inbound.media_received` | messaging-gateway | media-processor | origem + `kind` (`audio`, `image`), `mediaId`, `mimeType` |
| `media.processed` | media-processor | booking-agent (anotação por mensagem: miniatura e recusa no painel) | origem + `kind`, `status`, `storageKey`, `thumbnailKey?`, `transcribed`, `rejectionReason?` |
| `inbound.booking_requested` | messaging-gateway | booking-agent | origem + `sessionId`, `source` (`list`, `button`, `form`) |
| `inbound.cancellation_requested` | messaging-gateway | booking-agent | origem + `bookingId`, `source` |
| `inbound.waitlist_requested` | messaging-gateway | booking-agent | origem + `sessionId`, `source` |
| `inbound.delivery_status_changed` | gateway | booking-agent (métrica) | `messageId`, `status`, `errorCode?` |
| `outbound.reply_requested` | booking-agent | sender | `contactId`, `content` (`text` ou `choices`) |
| `attendance.handoff_requested` | booking-agent | fila `attendance.handoffs` | `conversationId`, `reason`, `requestedAt` |

Origem = `tenantId`, `contactId`, `messageId`, `receivedAt`.

### 4.3 Ferramentas MCP (saas-mcp-server)

| Ferramenta | Entrada | Saída |
| --- | --- | --- |
| `listar_horarios` | `estudio`, `contato`, `de`, `ate` (datas locais) | `aulas[]` com vagas, fila e `minha_reserva` |
| `reservar` | `estudio`, `contato`, `aula_id` | `reserva` (`confirmada` ou `em_espera` se a vaga acabou no caminho); aula lotada = erro `aula_lotada` |
| `cancelar` | `estudio`, `contato`, `reserva_id` | `reserva` cancelada e `fila_promovida` |
| `entrar_lista_espera` | `estudio`, `contato`, `aula_id` | `reserva` em espera; aula com vaga = erro `ha_vagas` |

Erro de domínio volta como resultado `isError` com `{codigo, mensagem, retentavel}`. `estudio` e `contato` são preenchidos pelo código a partir da conversa, nunca pelo LLM.

### 4.4 Estado no Redis

| Chave | Conteúdo | TTL |
| --- | --- | --- |
| `wba:webhook:seen:<id>` | marca de idempotência do webhook (id da mensagem ou id + status) | 7 dias (janela de reentrega da Meta) |
| `wba:conversation:<tenant>:<contato>` | snapshot JSON da Conversa com `version` (compare-and-set em Lua) | 30 dias |
| `wba:handoffs:<tenant>:tickets` | fila de atendimento: um hash por estúdio, com a ordem pelo `requestedAt` do ticket | por ticket (campo), 30 dias menos 1 hora, ou até a devolução ao bot |
| `wba:log:<tenant>:summaries` | resumo de cada conversa para a fila do painel (hash por estúdio) | por conversa (campo), 30 dias menos 1 hora |
| `wba:log:<tenant>:timeline:<conversa>` | linha do tempo da conversa (lista limitada a 200) | 30 dias menos 1 hora, desde a última atividade da própria conversa |
| `wba:media-notes:<tenant>:<mensagem>` | desfecho do processamento da mídia da mensagem | 30 dias por chave |

Os resumos e tickets usam prazo por campo de hash (`HEXPIRE`, Redis 7.4 ou mais novo): a atividade de uma conversa não renova o prazo de outra e nada com telefone ou prévia de mensagem sobrevive a 30 dias. Eles expiram uma hora antes da conversa, então o item que a fila lista sempre tem detalhe. Campos gravados por versões anteriores, sem prazo, ganham o prazo que teriam tido (ou são apagados, se já o passaram) na primeira leitura; o sorted set `:order` antigo é apagado no primeiro uso.

## 5. Fluxos principais

### 5.1 Texto → lista de horários → reserva por botão

```mermaid
sequenceDiagram
  autonumber
  participant A as Aluno
  participant M as Cloud API
  participant K as api-gateway
  participant W as webhook
  participant R as Redis
  participant Q as RabbitMQ
  participant B as booking-agent
  participant T as saas-mcp-server
  participant S as SaaS
  participant L as LLM
  participant X as sender

  A->>M: "Quais horários tem amanhã?"
  M->>K: POST /webhooks/cloud-api (X-Hub-Signature-256)
  K->>W: rate limit e limite de corpo, sem JWT
  W->>W: provedor valida HMAC do corpo bruto (porta MessagingProvider)
  W->>R: SET NX wba:webhook:seen:wamid
  W->>Q: inbound.message_received
  W-->>M: 200
  Q->>B: entrega (ack manual)
  B->>B: Conversa.receive (dedup) e política de escopo: in_scope(list_slots)
  B->>T: listar_horarios(estudio, contato, amanhã)
  T->>S: GET /v1/sessions e /v1/me/bookings
  T-->>B: aulas (linguagem de Agendamento)
  B->>B: Conversa.offerSlots (oferta válida por 30 min)
  B->>L: frase de abertura (schema + sem horários)
  B->>B: guard de citação (só horários das ferramentas)
  B->>Q: outbound.reply_requested (choices)
  Q->>X: entrega
  X->>M: lista interativa pelo provedor do estúdio (ids v1:bk:<aula>)
  A->>M: toca em "Hatha Yoga"
  M->>W: interactive.list_reply
  W->>Q: inbound.booking_requested
  Q->>B: entrega
  B->>B: aula foi oferecida? com vaga?
  B->>T: reservar(aula_id)
  T->>S: POST /v1/sessions/{id}/bookings
  B->>Q: "Pronto! Sua vaga em Hatha Yoga (ter 03/03 18:00) está confirmada."
```

### 5.2 Áudio e imagem

```mermaid
sequenceDiagram
  participant W as webhook
  participant Q as RabbitMQ
  participant P as media-processor
  participant S as S3
  participant B as booking-agent
  W->>Q: inbound.media_received(kind, mediaId)
  Q->>P: entrega
  P->>W: GET /internal/media/{estúdio}/{mediaId} (token de serviço)
  W->>W: provedor do estúdio baixa a mídia (Cloud API ou cache do Whatsmiau)
  P->>P: valida tipo pelos bytes e tamanho
  P->>S: guarda o original (expira em 30 dias)
  alt áudio
    P->>P: transcreve localmente (faster-whisper)
    P->>Q: media.processed e inbound.message_received(text, transcribed=true, mesmo messageId)
    Q->>B: segue o fluxo de texto
  else imagem
    P->>S: miniatura JPEG
    P->>Q: media.processed e inbound.message_received(unsupported)
  end
```

### 5.3 Transferência para humano

```mermaid
sequenceDiagram
  participant A as Aluno
  participant B as booking-agent
  participant Q as RabbitMQ
  participant H as Redis (fila de atendimento)
  participant P as Painel
  A->>B: "Estou com dor no joelho, posso ir?"
  B->>B: escopo determinístico: handoff(sensitive_topic)
  B->>B: Conversa.handOff → evento handoff_requested
  B->>Q: reply "Vou passar sua conversa para alguém da equipe"
  B->>Q: attendance.handoff_requested
  B->>H: ticket na fila do estúdio
  A->>B: "alô?"
  B->>B: Conversa.receive → silenced (registra, não responde)
  P->>B: POST /api/tenants/{t}/handoffs/{id}/resume
  B->>B: Conversa.resumeBot (falhas zeradas)
```

### 5.4 Envio com retry e DLQ

O sender consome `whatsapp-sender.replies`. Erro transitório da Cloud API (429, 5xx, rede, códigos de limite de taxa) vai para `whatsapp-sender.replies.retry` (TTL) e volta; depois de 5 tentativas vai para `.dlq`. Erro permanente (número inválido, janela de 24 horas expirada, token) vai direto para a DLQ com o motivo nos headers. Ver [ADR 0006](adr/0006-mensageria-rabbitmq.md).

## 6. Falhas e como são tratadas

| Falha | Tratamento |
| --- | --- |
| Assinatura inválida | 401, nada publicado, métrica `invalid_signature` e alerta |
| Webhook assinado mas fora do formato | 200 (reenvio não adiantaria), log de erro, nada publicado |
| Reentrega da Meta | idempotência no Redis: publica uma vez |
| RabbitMQ fora ao publicar no webhook | libera a chave de idempotência e responde 500: a Meta reentrega |
| Mensagem fora do contrato na fila | DLQ direto, sem retry |
| Redelivery no booking-agent | `Conversation.receive` deduplica pelo id |
| Dois consumidores na mesma conversa | compare-and-set por versão no Redis; o perdedor volta para a fila |
| LLM devolve JSON inválido ou cita horário | um retry com o motivo da rejeição; persistindo, interpretação vira falha e a frase de abertura cai para texto fixo |
| LLM fora do ar | conta como falha; o aluno recebe "indisponível" |
| SaaS fora do ar ou 5xx | `saas_indisponivel` retentável → falha do bot com resposta ao aluno |
| Regra de negócio do SaaS (conflito de horário, prazo de cancelamento) | erro de domínio mapeado → resposta explicando; não conta como falha |
| 2 falhas seguidas | transferência para humano por `repeated_failure` |
| Cair entre salvar a Conversa e publicar a resposta | a resposta está na caixa de saída (gravada junto com a Conversa); o varredor a publica, e a reentrega da mensagem vira `duplicate` ([ADR 0014](adr/0014-outbox-e-exclusao-mutua-por-contato.md)) |
| Publicar passar e a baixa na caixa de saída falhar | a entrada sai de novo quando a reserva vence: duplicata rara, a única que sobra |
| Duas mensagens do mesmo aluno ao mesmo tempo | lock por contato; quem espera além de 15 s volta pela fila de retry (`ContactBusy`); o compare-and-set segue como rede de segurança |
| Cloud API 429/5xx | retry com TTL até 5 vezes, depois DLQ |
| Cloud API 4xx definitivo | DLQ direto (`PermanentFailure`) |

## 7. Segurança

- **Borda**: o api-gateway (Kong) é a única entrada pública, com rate limit e limite de corpo por rota; os webhooks não passam por JWT e `/internal` não tem rota pública ([ADR 0012](adr/0012-api-gateway-kong.md)).
- **Webhook**: Cloud API, HMAC-SHA256 do corpo bruto com o App Secret; Whatsmiau, segredo compartilhado no cabeçalho da instância (ele não assina o corpo), ambos em tempo constante e validados no messaging-gateway; token do handshake também em tempo constante; limite de 256 KB (Cloud API) e 20 MB (Whatsmiau, que embute mídia).
- **Cloud API oficial como padrão**, com token de sistema guardado fora do código (`.env` em desenvolvimento, cofre em produção). Whatsmiau é opt-in por estúdio, com os riscos do ADR 0010.
- **Identidade nas ferramentas** sempre vinda da conversa (estúdio pelo número que recebeu a mensagem, contato pelo remetente). O LLM não preenche argumento de identidade e não chama ferramentas.
- **Servidor MCP** em rede interna e protegido por token compartilhado; o SaaS continua aplicando isolamento por tenant e RBAC pelo JWT.
- **Dados pessoais (LGPD)**: telefone e texto do aluno são censurados nos logs (redação no pino); erros nunca incluem corpo de resposta da Meta, do SaaS ou do LLM (podem ecoar a mensagem); o painel recebe o contato mascarado; o áudio expira em 30 dias no bucket; a transcrição é local, então a voz do aluno não vai para API de terceiros.
- **OWASP API**: validação de entrada por schema em todas as fronteiras (webhook, fila, ferramentas, LLM, configuração); sem SSRF (URLs de mídia só da Cloud API configurada ou dos hosts permitidos do Whatsmiau); falha de configuração derruba o processo na subida citando só o nome da variável.
- **Painel**: login por OIDC no Keycloak (code + PKCE); o api-gateway valida o JWT (RS256, `exp`) e o booking-agent valida de novo e extrai estúdio (role `tenant:<id>`) e papel (`attendant`, `manager`) do token; o `:tenantId` da URL precisa ser o do token, em todas as rotas, com teste de vazamento por rota ([ADR 0013](adr/0013-login-do-painel-oidc.md)). A rota `/internal` usa token de serviço e não tem rota pública.

## 8. Observabilidade

| Sinal | Como |
| --- | --- |
| Logs | JSON em stdout (pino nos serviços Node, slog no Go, logging no Python), com `service`, `correlationId` (id da mensagem do WhatsApp), `trace_id` e `span_id`; telefone e texto censurados |
| Métricas | Prometheus em `/metrics` de cada serviço: `wba_webhook_requests_total{provider,result}`, `wba_webhook_items_total{provider,type,outcome}`, `wba_agent_turns_total{outcome}`, `wba_handoffs_total{reason}`, `wba_llm_output_rejected_total{stage}`, `wba_citation_violations_total`, `wba_queue_messages_total{queue,result}`, `wba_outbound_messages_total{provider,result}`, `wba_provider_request_seconds{provider}`, `wba_mcp_tool_calls_total{tool,result}`, `wba_saas_request_seconds{route,status}` |
| Traces | OpenTelemetry com propagação W3C pelos headers do RabbitMQ e pelo HTTP do MCP até o SaaS; exportação OTLP para o Jaeger quando `OTEL_EXPORTER_OTLP_ENDPOINT` está definido |
| Alertas | `infra/prometheus/alerts.yml`: citação fora das ferramentas (page), assinatura inválida, mensagens na DLQ e taxa de transferência por falha acima de 5% |

## 9. Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Bibliotecas não oficiais do WhatsApp Web | violam os termos da Meta e derrubam o número; ver [ADR 0003](adr/0003-escopo-fechado-e-recusas.md) |
| Agente ReAct livre, com o LLM chamando as ferramentas | o LLM poderia inventar ids, horários e identidade; o grafo com nós fixos é previsível e testável ([ADR 0008](adr/0008-agente-langgraph-como-adapter.md)) |
| Messaging-gateway como serviço por provedor | duplicaria idempotência, mídia e roteamento por estúdio; a porta `MessagingProvider` isola o código com um só deploy (ADR 0010) |
| Monólito único com webhook, agente e envio | o webhook precisa responder rápido e escalar diferente do agente (que espera LLM); o envio tem retry próprio |
| Domínio direto sobre os tipos do SaaS | qualquer mudança do SaaS vazaria para as regras do bot; ACL isola ([ADR 0002](adr/0002-anti-corruption-layer.md)) |
| Kafka em vez de RabbitMQ | o problema é fila de trabalho com retry e DLQ por consumidor, não log de eventos com replay ([ADR 0006](adr/0006-mensageria-rabbitmq.md)) |
| Transcrição por API de terceiros | voz do aluno sairia da infraestrutura do estúdio; custo por minuto |
| Sender separado em serviço próprio | duplicaria a ACL da Cloud API; ficou no gateway, em processo separado ([ADR 0001](adr/0001-mapa-de-servicos.md)) |

## 10. Custos e riscos humanos

- **LLM**: só é chamado quando a política determinística não decide (interpretação) e para a frase de abertura de listas. Saudação, recusa óbvia, pedido de humano, temas sensíveis e cliques em botões não chamam o modelo. Em desenvolvimento roda local (Ollama, custo zero); em produção, modelo pequeno basta (classificação e uma frase).
- **Cloud API**: respostas dentro da janela de atendimento de 24 horas iniciada pelo aluno não usam template pago.
- **Riscos humanos**: um bot que opina sobre dor, gravidez ou cobrança pode causar dano. Esses temas vão sempre para humano, por regra determinística que o LLM não reverte. O bot nunca promete o que a ferramenta não confirmou.

## 11. Cursos exercitados

Conforme `courses.yaml` (`exercised_by: whatsapp-booking-agent`):

| Curso | Onde aparece |
| --- | --- |
| FC4 Design de APIs | webhook, contratos versionados, erros com código estável, ferramentas MCP |
| FC4 Testes avançados | testes de contrato com payloads reais anonimizados, regressão do guard de citação, integração com testcontainers |
| FC4 Hexagonal e Clean Architecture | portas e adaptadores em todos os serviços; domínio sem framework, garantido pelo lint |
| FC4 RabbitMQ | topologia com filas quorum, retry com TTL, DLQ, ack manual, publisher confirms |
| FC4 DDD e eventos | agregados com invariantes, linguagem publicada, ACL, eventos de domínio |
| FC4 OWASP e Vault | assinatura do webhook, validação nas fronteiras, redação de dados pessoais, segredos fora do código |
| UNIPDS 9.2 Ollama | LLM local em desenvolvimento pela API compatível com OpenAI |
| UNIPDS 4.3 Tool use | servidor MCP em Go com quatro ferramentas, chamado pelo código do grafo |
| UNIPDS 4.4 Memória | a Conversa guarda a oferta, as falhas e as mensagens processadas |
| UNIPDS 4.5 Contexto | o LLM recebe só a mensagem e as ofertas vigentes, não o histórico inteiro |
| UNIPDS 4.7 Autonomia | transferência para humano e limites do que o bot decide sozinho |
| UNIPDS 8.m4 Padrões de IA | roteamento determinístico antes do LLM, validação por schema com retry |
| UNIPDS 10 Riscos e custos | temas sensíveis para humano, LLM só no ambíguo, transcrição local |

## 12. Plano de evolução (próximos passos)

O que já saiu do plano (vínculo do aluno, caixa de entrada humana, avisos por template, media-processor com retry e miniaturas, login do painel) está descrito na seção 2 e nos ADRs 0009, 0011 e 0013. O que falta:

1. **Templates aprovados na Meta**: o código já envia `lembrete_aula` e `vaga_liberada`; falta criá-los e aprová-los na conta Business (depende do autor).
2. **Flow de agendamento publicado** na Meta (o tradutor já entende a conclusão `{action, target_id}`; depende de credencial).
3. **Whatsmiau real**: validar o adaptador contra uma instância pareada (hoje fixtures no formato documentado e mock) e decidir o LID não resolvido (o resolvido já funciona; falta confirmar se o envio aceita LID).
4. **media-processor**: teste de integração com RabbitMQ e S3 reais (o retry até a DLQ e a leitura da miniatura hoje só são testados sem broker nem bucket).
5. **Testes de mutação** no domínio (Stryker): falta a dependência no manifest e no lockfile. O ponta a ponta no compose e a carga no webhook (k6) rodam no job `e2e` do CI.
6. **Login contra um Keycloak real** (hoje só o realm de desenvolvimento e provedor falso nos testes), rotação da chave pública no Kong e token de serviço por estúdio na rota `/internal`.
7. **Deploy**: o chart Helm (`deploy/helm/wba`) só foi validado por `helm lint` e `helm template` no CI; falta instalá-lo num cluster e ligá-lo ao gateway compartilhado e ao GitOps do `platform-edge`.
