# ADR 0009: Vínculo telefone → aluno por conta de serviço com delegação restrita

**Status:** Aceito

## Contexto

O servidor MCP precisa agir no SaaS como o aluno que escreveu no WhatsApp. Até aqui usava um token de desenvolvimento por estúdio (`SAAS_DEV_TOKENS`), que age como qualquer pessoa e não prova que o telefone pertence ao aluno.

## Decisão

**Conta de serviço por estúdio no Keycloak, com delegação restrita a alunos que fizeram opt-in verificado.**

- Um client confidencial por estúdio (`whatsapp-agent-lotus`, `whatsapp-agent-equilibrio`), só com `client_credentials`, mappers de `tenant` e audiência `studio-api` e a realm role `whatsapp_agent`. O token dessa conta, sozinho, não acessa nada do domínio: a role não é um papel do estúdio.
- **Opt-in**: o aluno logado no SaaS gera um código de 6 dígitos (10 min, uso único, guardado como HMAC) e o envia pelo WhatsApp: `vincular 123456`. O agente reconhece o comando por regra (sem LLM) e chama a ferramenta MCP `vincular_contato`; o servidor MCP confirma o código no SaaS (`POST /api/v1/integrations/whatsapp/links`) com o telefone do remetente. O SaaS guarda só o HMAC do telefone.
- **Delegação**: nas rotas do aluno, o servidor MCP envia o token da conta de serviço e o header `X-WhatsApp-Contact: <wa_id>`. O SaaS resolve o vínculo no tenant da claim e autentica como o aluno vinculado, com as policies, o isolamento e as regras do aluno. Sem vínculo: 403 `whatsapp_contact_not_linked`, que o agente traduz em orientação de opt-in.
- O servidor MCP obtém o token por `client_credentials` (`golang.org/x/oauth2`, com cache até perto de expirar) quando `SAAS_TOKEN_URL` está definida; sem ela, mantém os tokens de desenvolvimento para rodar contra o mock do SaaS.

## Consequências

- Revogação imediata: o aluno apaga o vínculo (`DELETE /api/v1/me/whatsapp-link`) ou o client do estúdio é desativado no Keycloak.
- O agente nunca custodia credencial de aluno; o vazamento do segredo de um estúdio só alcança alunos daquele estúdio que fizeram opt-in.
- O SaaS confia na conta de serviço para afirmar o telefone do remetente. Mitigação: o webhook que origina a mensagem é assinado pela Meta, e o código de opt-in prova a posse da conta do SaaS.
- Um client (e um segredo) por estúdio, para operar.

## Alternativas

- **Token exchange RFC 8693 com impersonation no Keycloak**: o padrão v2 do Keycloak 26 não suporta impersonation nem `requested_subject`; só o token exchange legado v1 (preview), que exige fine-grained admin permissions, fala em nome de outro usuário. Dependeria de recurso em preview.
- **Token de dev compartilhado**: age como qualquer um e não prova posse do telefone.
- **Refresh token offline do aluno guardado no agente**: o agente passaria a custodiar uma credencial de longa duração de cada aluno.

## Configuração

`SAAS_TOKEN_URL` (endpoint de token do realm) e `SAAS_AGENT_CLIENTS` (JSON estúdio → `{client_id, client_secret}`, segredos `dev-only-*` em desenvolvimento). Contrato do SaaS: branch `feat/whatsapp-vinculo` do `saas-multitenant`.
