# Roteiro: transferência para humano

Núcleo: quando a conversa sai do que o bot deve conduzir, ela vai para uma pessoa e o bot para de responder.

Código: `services/booking-agent/src/domain/conversation.ts` (`recordFailure`, `handOff`, `receive`, `resumeBot`), `src/application/handle-inbound.ts`, `src/application/resume-conversation.ts`, `src/adapters/persistence/redis.ts` (`RedisHandoffQueue`), `src/adapters/http/server.ts` e o painel em `web/`. Testes: `tests/domain/conversation.test.ts`, `tests/agent/scope-and-handoff.test.ts`, `tests/application/handle-inbound.test.ts`, `tests/adapters/panel-api.test.ts`. Decisão: [ADR 0004](../adr/0004-transferencia-para-humano.md).

## O problema

Três situações em que insistir no bot é pior que parar:

1. **Pedido explícito**: "quero falar com uma pessoa". Ignorar é o atalho mais rápido para o aluno reclamar do estúdio.
2. **Tema sensível**: dor, lesão, gravidez, cirurgia, ansiedade; cobrança, reembolso; reclamação, Procon. Um bot que responde "pode vir sim!" a quem relatou dor no joelho causa dano real.
3. **Falha repetida**: o bot não entende, o LLM está fora, a agenda está fora. O aluno repete a pergunta e recebe "não entendi" de novo.

E um requisito operacional: depois de transferida, **o bot não pode continuar respondendo** em paralelo com a pessoa.

## A solução

### No domínio

A transferência é estado do agregado `Conversation`, não um flag espalhado:

- `handOff(reason, now)`: muda para `handed_off`, apaga a oferta vigente (o aluno não pode reservar por um botão antigo enquanto fala com a pessoa) e emite `handoff_requested` **uma única vez**. Chamar de novo não emite outro evento.
- `recordFailure(now)`: soma uma falha; na **2ª seguida** chama `handOff('repeated_failure')`. `recordSuccess()` zera o contador.
- `receive(messageId)`: com a conversa transferida, devolve `silenced`. O id é registrado (deduplicação continua valendo), mas o caso de uso não chama o agente.
- `resumeBot(now)`: só a partir de `handed_off`; zera falhas e emite `bot_resumed`.

O que conta como falha é decisão explícita no grafo: interpretação inválida mesmo após o retry, LLM fora do ar, agenda indisponível, erro inesperado de ferramenta. **Não** contam: recusa de escopo e recusa de regra de negócio do SaaS (conflito de horário, prazo de cancelamento), porque nesses casos o bot respondeu certo.

### Na aplicação

`HandleInboundMessage` transforma o evento de domínio em duas saídas: a mensagem ao aluno ("vou passar sua conversa para alguém da equipe") e `attendance.handoff_requested` na fila, além de um ticket na fila de atendimento do estúdio no Redis (hash + sorted set pela hora do pedido, por tenant).

### No painel

`GET /api/tenants/{tenant}/handoffs` lista quem espera, com motivo e contato mascarado. `POST .../{conversationId}/resume` devolve ao bot. O painel (Vue + TanStack Query) atualiza a cada 10 segundos e invalida o cache depois de devolver. O ticket só é encontrado dentro do próprio tenant.

## Alternativas e trade-offs

| Decisão | Alternativa | Por que a escolhida |
| --- | --- | --- |
| 2 falhas seguidas | 3 ou mais | o custo de uma pessoa assumir cedo é menor que o de o aluno repetir; ajustável por constante |
| Recusa não conta | contar tudo | evitaria abuso? Não: só encheria a fila humana com quem testa o bot |
| Bot silencia | bot continua respondendo | mensagens contraditórias; o aluno não sabe com quem fala |
| Detectar tema sensível por regra | deixar o LLM detectar | precisa ser garantido; LLM pode errar justamente no caso grave |
| Fila no Redis | tabela relacional | volume pequeno, leitura por tenant ordenada; persistência relacional entra com a caixa de entrada |

## Perguntas de entrevista

**Por que a transferência é regra de domínio e não do agente?**
Porque é invariante do negócio ("transferida, o bot não fala") que precisa valer para qualquer adaptador: hoje o LangGraph, amanhã outro. No domínio, eu testo sem LLM, sem fila e sem Redis.

**O que impede o bot de responder depois da transferência?**
`receive` devolve `silenced` e o caso de uso retorna antes de chamar o agente. Além disso, os métodos que geram ação (`offerSlots`, `recordFailure`) lançam `conversation_handed_off` se forem chamados nesse estado: mesmo um bug no agente não produz oferta.

**E se duas mensagens chegarem juntas, uma delas pedindo humano?**
Os consumidores podem processar em paralelo. A Conversa tem versão e o Redis grava com compare-and-set: o segundo a salvar recebe `ConcurrentModification`, a mensagem volta para a fila e é reprocessada sobre o estado novo (já transferido), virando `silenced`.

**Como o atendente responde?**
Nesta rodada, pelos canais do estúdio; o painel mostra a fila e devolve ao bot. A caixa de entrada (histórico e resposta pelo sender, dentro da janela de 24 horas) é o próximo passo.

**Por que mascarar o telefone no painel se o atendente precisa contatar o aluno?**
Minimização (LGPD): a fila serve para priorizar, não para exportar contatos. Quando a caixa de entrada existir, o atendente responde pela própria plataforma sem precisar ver o número completo.

**Como você mediria se a transferência está calibrada?**
`wba_handoffs_total{reason}` contra `wba_agent_turns_total`. Muita `repeated_failure` indica LLM ou agenda instáveis (há alerta acima de 5%); muita `sensitive_topic` pode indicar termos amplos demais. Amostras anonimizadas das conversas transferidas viram casos de teste.
