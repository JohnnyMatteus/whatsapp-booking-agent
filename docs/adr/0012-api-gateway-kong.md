# ADR 0012: API Gateway com Kong OSS em modo DB-less

**Status:** Aceito. A autenticação do painel foi substituída pelo ADR 0013 (OIDC, RS256, sem token injetado).

## Contexto

Os webhooks públicos dos provedores (Meta e Whatsmiau) e a API do painel precisam de uma entrada única, com roteamento, rate limit e validação de JWT para o painel. Os webhooks dos provedores **não** passam por JWT: a Meta assina o corpo (HMAC) e o Whatsmiau envia um segredo em cabeçalho; ambos são validados no messaging-gateway. Antes, o nginx do painel injetava um token estático e o webhook ficava exposto direto na porta do serviço.

Os candidatos eram Kong OSS e KrakenD CE, o mesmo par que o portfólio avaliou no `platform-edge`.

## Decisão

Usar o **Kong OSS 3.9 em modo DB-less**, o mesmo gateway do `platform-edge` (ADR 0001 de lá), com a configuração declarativa em `infra/gateway/kong.yaml` embutida numa imagem própria.

| Requisito | Decisão no Kong |
| --- | --- |
| Roteamento | `/webhooks/cloud-api` (GET e POST) e `/webhooks/whatsmiau` (POST) para o messaging-webhook; `/api` para o booking-agent. Sem rota para `/internal` (mídia e avisos ficam na rede interna). |
| Webhooks | Sem JWT. Rate limit por IP (600 por minuto), corpo de até 256 KB (Cloud API) e 20 MB (Whatsmiau, que pode embutir mídia em base64). Sem retry no gateway: o provedor reentrega e a idempotência está no messaging-gateway. |
| Painel | Plugin `jwt` (RS256, consumidor `painel`, `iss`, `exp` obrigatório e validade máxima de 1 hora), rate limit por consumidor (120 por minuto), corpo de até 64 KB. O `Authorization` do atendente segue para o booking-agent, que valida de novo (ADR 0013). |
| Observabilidade | Plugin `prometheus` na porta de status 8100, raspada pelo Prometheus. |

O que pesou, como no portfólio: rate limit com cabeçalhos de cota nativos e limite por consumidor, e configuração como código sem estado escondido. KrakenD teria JWKS nativo, mas o painel não precisa disso agora.

Configuração: o Kong não interpola variáveis no arquivo declarativo. O `entrypoint.sh` renderiza o emissor (`OIDC_ISSUER`) e a chave pública do realm (`PANEL_JWT_PUBLIC_KEY_FILE`) e aborta se sobrar marcador sem valor.

## Consequências

- Uma porta pública (`GATEWAY_PORT`, 8000); messaging-webhook e booking-agent deixam de publicar porta no host.
- O login do painel e a chave do realm estão no ADR 0013; o smoke do CI usa um par de chaves descartável.
- O rate limit `policy: local` conta por instância do Kong; com réplicas, a cota efetiva multiplica (mesma limitação do portfólio).
- O CI faz `kong config parse` e um smoke das políticas (JWT, webhooks sem JWT, `/internal` fora do ar, limite de corpo).

## Alternativas

- **KrakenD CE**: JWKS e papéis nativos, mas 429 sem cabeçalhos de cota e limite por cliente mais trabalhoso.
- **Manter o nginx**: já serve o SPA, mas rate limit por consumidor e validação de JWT exigiriam módulos extras.
- **Validar JWT no booking-agent**: espalharia a política; o gateway concentra a borda.
