# ADR 0010: Messaging-gateway e provedores de WhatsApp atrás de uma porta

**Status:** Aceito. Emenda o ADR 0003 (item 1) e o ADR 0001 (mapa de serviços).

## Contexto

O `whatsapp-gateway` era a fronteira com a Cloud API da Meta nos dois sentidos. O autor pediu um **serviço de integrações separado**, que concentre os provedores de WhatsApp, e um provedor alternativo: o **Whatsmiau**, servidor Go sobre a biblioteca whatsmeow (protocolo do WhatsApp Web/multi-dispositivo), com API compatível com a Evolution API. A escolha do provedor é por estúdio (tenant). O domínio e o booking-agent não podem saber qual provedor está em uso.

O que o Whatsmiau oferece (verificado no repositório `verbeux-ai/whatsmiau`: README, DTOs, modelos de webhook e contrato Swagger 2.0 em `docs/swagger.json`):

- **Autenticação**: cabeçalho `apikey` (variável `API_KEY` do servidor) em todas as rotas `/v1`.
- **Envio**: `POST /v1/message/sendText/{instance}` (`number`, `text`), `sendButtons` (`number`, `description`, `buttons[{type:"reply", displayText, id}]`, máximo 3), `sendList` (`number`, `description`, `buttonText`, `sections[{title, rows[{title, description, rowId}]}]`), `sendMedia`, `sendWhatsAppAudio`. A resposta traz `key.id`.
- **Webhook de entrada**: configurado por instância (`url`, `events`, `headers`, `base64`). Formato Evolution API: `{event, instance, data, date_time, ...}`. Eventos usados aqui: `messages.upsert` (mensagem recebida, com `key.remoteJid`, `key.fromMe`, `message.conversation`, `audioMessage`, `imageMessage`, `listResponseMessage.singleSelectReply.selectedRowId`, `buttonsResponseMessage.selectedButtonId`, `base64` ou `mediaUrl` quando ligado) e `messages.update` (recibo: `status` `DELIVERY_ACK` ou `READ`).
- **Autenticidade do webhook**: o Whatsmiau **não assina o corpo**. A única proteção é o campo `headers` da instância, entregue como cabeçalhos HTTP fixos, e ele só os envia a URLs HTTPS.

## Decisão

1. Novo serviço **`services/messaging-gateway`** (o antigo `whatsapp-gateway`, renomeado e reestruturado). Nome: o serviço deixa de ser "do WhatsApp" para ser o ponto de integração de mensageria; um terceiro canal entraria sem renomear.
2. Porta única **`MessagingProvider`** (`src/ports.ts`): `verifyWebhook`, `verifySubscription` (handshake, opcional), `parseWebhook` (mensagens e status de entrega), `send` (texto, botões, listas e templates, a partir de `ReplyRequested`) e `fetchMedia`. Cada provedor traduz de e para a linguagem publicada (`@wba/contracts`) na sua própria ACL.
3. Provedores:
   - **`providers/cloud-api`**: o adaptador oficial; a ACL da Cloud API que estava no `whatsapp-gateway` foi movida para cá. Tipos da Meta só em `providers/cloud-api/acl/cloud-api-types.ts`.
   - **`providers/whatsmiau`**: adaptador novo com ACL própria. Tipos do Whatsmiau só em `providers/whatsmiau/acl/whatsmiau-types.ts`. Testes de contrato com payloads anonimizados no formato documentado (`tests/whatsmiau/fixtures`).
4. **Escolha por estúdio, por configuração**: `TENANT_CHANNELS={"estudio-lotus":{"provider":"cloud-api","phoneNumberId":"..."},"estudio-sol":{"provider":"whatsmiau","instance":"..."}}`. Sem `provider`, vale a **Cloud API** (padrão). O `ProviderRegistry` resolve o provedor do estúdio; o sender e o webhook só enxergam a porta. Whatsmiau só é habilitado se configurado (`WHATSMIAU_BASE_URL`, `WHATSMIAU_API_KEY`, `WHATSMIAU_WEBHOOK_SECRET`); estúdio nele sem a configuração derruba a subida.
5. **Webhooks**: `/webhooks/cloud-api` (assinatura `X-Hub-Signature-256`, HMAC do corpo bruto) e `/webhooks/whatsmiau` (segredo compartilhado, em tempo constante, no cabeçalho `x-webhook-secret` configurado na instância). Idempotência continua pelo id da mensagem, com prefixo do provedor. Sem JWT: a autenticação é do provedor (ADR 0012).
6. **Protocolo de ids interativos compartilhado** (`v1:bk:<aula>`): a escolha do aluno volta como o mesmo comando em qualquer provedor.
7. **Mídia**: `fetchMedia` esconde a diferença. Cloud API: `GET /{media-id}` e download com token. Whatsmiau: o webhook traz `base64` ou `mediaUrl`; o gateway guarda a mídia no Redis por 1 hora e a entrega pela API interna `GET /internal/media/{tenant}/{mediaId}` (token de serviço; sem rota pública). URL de mídia só é baixada de hosts da lista `WHATSMIAU_MEDIA_HOSTS` (padrão: o host do Whatsmiau), contra SSRF.
8. **Templates**: a Cloud API usa templates aprovados. O Whatsmiau não tem o conceito; os dois avisos (`lembrete_aula`, `vaga_liberada`) viram texto com o mesmo conteúdo.
9. O booking-agent fala **só** com o messaging-gateway (fila RabbitMQ e, para mídia, o media-processor pela API interna); nenhum tipo ou nome de provedor existe fora de `providers/`.

## Riscos do Whatsmiau (leia antes de habilitar)

O Whatsmiau **não é uma API oficial da Meta**. Ele conecta um número como "aparelho vinculado" (pareamento por QR code) e fala o protocolo do WhatsApp Web.

- **Banimento do número**: a Meta pode bloquear, temporária ou definitivamente, números que usam clientes não oficiais, e a detecção costuma ser acionada por volume, mensagens a quem não é contato e conteúdo repetido. Perder o número do estúdio significa perder o canal e o histórico de clientes.
- **Violação dos termos**: os Termos de Serviço do WhatsApp e da WhatsApp Business proíbem acesso automatizado por meios não autorizados. Usar o Whatsmiau é decisão e responsabilidade do estúdio, que precisa estar ciente.
- **Política de chatbots muda**: desde 15/01/2026 a Meta proíbe chatbots de uso geral na plataforma Business. Fora da Cloud API não há mecanismo oficial de contestação, e o escopo fechado (ADR 0003) deixa de ser garantia de conformidade para esse canal.
- **Sem garantias de contrato**: sem versionamento, SLA ou aviso de mudança; um update do WhatsApp pode quebrar a sessão até a biblioteca acompanhar. Sem templates aprovados nem janela de 24 horas controlada pela plataforma.
- **Autenticação fraca do webhook**: segredo estático em cabeçalho, sem HMAC nem anti-replay. Exige HTTPS no webhook (o Whatsmiau recusa enviar cabeçalhos por HTTP) e a idempotência do gateway.
- **Operação**: a sessão é estado (Redis e banco do Whatsmiau); desconexão exige novo QR code.

### Quando usar cada provedor

| | Cloud API (padrão) | Whatsmiau |
| --- | --- | --- |
| Produção, estúdio que não pode arriscar o número | Sim | Não |
| Conformidade com a política da Meta | Sim (oficial) | Sem garantia |
| Avisos fora da janela de 24 horas | Templates aprovados | Texto livre, aumenta o risco de banimento |
| Demonstração, laboratório, estúdio pequeno que aceita o risco por escrito | Se tiver conta aprovada | Pode servir, com número descartável e baixo volume |
| Custo de entrada | Conta Business, verificação, templates | Um número e um QR code |

Recomendação: **Cloud API por padrão**; Whatsmiau só por opção explícita do estúdio, com número que ele aceite perder, baixo volume e sem envio proativo em massa.

## Assunções não verificáveis (marcadas no código com `ASSUNÇÃO`)

- Os limites de tamanho de botões e listas são os do WhatsApp (iguais aos da Cloud API); o Whatsmiau não os documenta.
- O texto pode chegar como `message.conversation` ou `message.extendedTextMessage.text` (convenção Evolution; só o primeiro aparece no modelo lido).
- Só JIDs de número (`@s.whatsapp.net`) são tratados; `@lid` é ignorado até haver mapeamento para o número.
- A fixture de envio de mídia do Whatsmiau não está coberta (o bot não envia mídia).
- Não foi possível rodar um Whatsmiau real (exige número pareado): o CI usa fixtures no formato documentado e o mock WireMock do profile `whatsmiau`.

## Consequências

- Trocar de provedor de um estúdio é configuração; nenhum caso de uso muda.
- Dois conjuntos de testes de contrato (um por ACL), mais testes do roteamento por estúdio.
- A regra "nenhum tipo da Meta fora de um arquivo" vira "nenhum tipo de provedor fora do seu arquivo de ACL".
- O ADR 0003 continua valendo para a Cloud API; o Whatsmiau é exceção consciente, documentada aqui.

## Alternativas

- **Evolution API em vez do Whatsmiau**: mesmo formato (o adaptador serviria com pouco ajuste), mas é um servidor maior; o autor pediu o Whatsmiau.
- **Um serviço por provedor**: isolaria deploys, mas duplicaria idempotência, mídia e roteamento por estúdio. A porta única dá o mesmo isolamento de código com um deploy.
- **Escolha por variável global**: simples, mas um estúdio de teste e outro de produção não conviveriam.
