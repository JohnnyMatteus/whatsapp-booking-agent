# ADR 0002: Anti-Corruption Layer para a Cloud API e para o SaaS

**Status:** Aceito

## Contexto

O domínio de Agendamento depende de dois sistemas que não controlamos:

1. **WhatsApp Cloud API**: payload aninhado (`entry[].changes[].value.messages[]`), dezenas de tipos de mensagem, interativos com formatos distintos (lista, botão, Flow), status de entrega com códigos próprios, campos novos sem aviso e versões da Graph API que expiram.
2. **SaaS de estúdios**: modelo próprio (`tenant`, `class_session`, `booking` com `confirmed`/`waitlisted`/`canceled`, erros `problem+json` com `type`), paginação do Laravel e uma regra que conflita com o bot: reservar em aula lotada coloca o aluno na fila sem perguntar.

Se esses modelos entrarem no domínio, qualquer mudança da Meta ou do SaaS quebra regras de negócio, e os testes do núcleo passam a depender de payloads externos.

## Decisão

Tradutores na infraestrutura, atrás das portas, nos dois pontos:

- **WhatsApp** (uma ACL por provedor, ADR 0010): `services/messaging-gateway/src/providers/cloud-api/acl` (`translateWebhook` e `translateReply`; tipos da Meta só em `cloud-api-types.ts`) e `providers/whatsmiau/acl` (`translateWhatsmiauWebhook` e `translateReply`; tipos do Whatsmiau só em `whatsmiau-types.ts`). Os dois convertem para a mesma linguagem publicada (`@wba/contracts`). Item desconhecido no lote vira "ignorado" sem derrubar os outros. Até o vocabulário da origem da escolha é neutro (`list`, `button`, `form`, não `list_reply`): um teste falha se um nome de campo da Meta aparecer no comando.
- **SaaS** (`services/saas-mcp-server/internal/adapters/saas`): `toAula`, `toReserva` e `toDomainError` com mapas explícitos de status e de `type` de erro. Valor novo do SaaS cai num caso conhecido (`saas_indisponivel` ou `erro_inesperado`), nunca passa adiante sem tradução. O `detail` do SaaS não é repassado (texto livre não é contrato). A regra da fila silenciosa é corrigida aqui: `reservar` em aula lotada devolve `aula_lotada`, e entrar na fila é a ferramenta `entrar_lista_espera`.
- **Segunda barreira** no booking-agent (`adapters/mcp/scheduling-tools.ts`): a resposta das ferramentas é validada por schema e reconstruída como agregados (`ClassSession.create` reaplica as invariantes); cada código de erro tem destino explícito em `DomainError`, e código desconhecido é falha do bot, não regra de negócio.

Cada tradutor tem **testes de contrato** com payloads no formato real, anonimizados: `tests/cloud-api/fixtures/` e `tests/whatsmiau/fixtures/` no messaging-gateway e `internal/adapters/saas/testdata/` no servidor MCP.

## Consequências

- O domínio e o agente são testados só com tipos próprios; trocar a versão da Graph API ou o formato do SaaS mexe em um arquivo e nos seus testes de contrato.
- **Custo de manter os tradutores**: cada tipo novo de mensagem, campo ou erro exige mudança no tradutor e uma fixture nova. Estimativa: a Meta muda a Graph API a cada trimestre (versões vivem cerca de dois anos), e o SaaS é nosso, mas evolui em outro ritmo. O custo é previsível e localizado, o oposto de mudanças espalhadas pelo agente.
- Há mapeamento duplicado de propósito (Go e TypeScript). O Go fala a linguagem de Agendamento para qualquer cliente MCP; o TypeScript protege os agregados contra um servidor com bug.
- O protocolo de ids interativos (`v1:<ação>:<alvo>`) é versionado: botões antigos no histórico do aluno continuam decodificáveis ou caem como texto.

## Alternativas

- **Usar os tipos da Meta e do SaaS direto no domínio**: menos código hoje, acoplamento permanente.
- **SDK de terceiros para a Cloud API**: esconde o payload, mas acopla o projeto ao ritmo de atualização do SDK e ainda exigiria tradução para o domínio.
- **Uma ACL só no booking-agent**: o servidor MCP devolveria o modelo do SaaS cru e qualquer outro cliente MCP teria de traduzir de novo.
