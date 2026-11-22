# ADR 0014: Caixa de saída (outbox) no Redis e exclusão mútua por contato

**Status:** Aceito. Emenda o ADR 0005 (ordem de publicar e salvar) e o ADR 0006 (consequências sobre a ordem por contato).

## Contexto

Até aqui o booking-agent **publicava as respostas e depois salvava a Conversa** (ADR 0005). Isso tinha dois defeitos:

- Uma queda entre publicar e salvar fazia a reentrega responder de novo.
- Um conflito de versão no `save` (dois consumidores na mesma conversa) acontecia **depois** de a resposta ter saído: a reentrega refazia o turno e a resposta saía duas vezes.

Além disso, duas mensagens do mesmo aluno chegando juntas rodavam o agente (LLM e ferramentas) em paralelo; só o compare-and-set da Conversa impedia a gravação dupla, descartando o trabalho do perdedor.

## Decisão

1. **Salvar e enfileirar a saída são uma operação só.** O `save` da Conversa recebe uma entrada da caixa de saída (`OutboxEntry`: id, `correlationId` e as mensagens do turno) e o script Lua do compare-and-set grava, na mesma execução atômica, a Conversa e a entrada (`wba:outbox:entries`, um hash com prazo de 7 dias por campo, e `wba:outbox:order`, um sorted set só de ids). Conflito de versão não grava nada, nem a saída.
2. **Publicar vem depois, por um relay.** O turno publica a sua própria entrada logo depois de salvar (`OutboxRelay.deliver`: reserva a entrada por 30 s, publica com confirmação do broker, remove). Se a publicação falhar ou o processo cair, a entrada fica na caixa e um **varredor** (a cada `OUTBOX_SWEEP_INTERVAL_MS`, 5 s, e uma vez na subida) a publica. A reserva e a leitura da entrada são uma operação só (`claim`, script Lua `HGET` + `SET NX EX`): impede que duas instâncias publiquem a mesma entrada ao mesmo tempo e que quem leu a lista de pendentes publique de novo uma entrada que o turno acabou de concluir. As varreduras do mesmo processo não se sobrepõem. A reentrega da mesma mensagem passa a ser `duplicate` (a Conversa já a registrou), e a resposta não se perde porque está na caixa.
3. **Entrega pelo menos uma vez.** Se a publicação passar e o `complete` falhar, a entrada sai de novo quando a reserva vencer. É a duplicata rara de antes, sem mais o caso do conflito de versão. A métrica `wba_outbox_pending` (e o alerta `CaixaDeSaidaParada`) mostra quando algo não está saindo.
4. **Exclusão mútua por contato.** O consumidor envolve cada turno num lock `SET NX PX` por `estúdio:contato` (`RedisContactLock`), liberado só pelo dono (script Lua com comparação do token). Quem não consegue a vez em `CONTACT_LOCK_WAIT_MS` (15 s) lança `ContactBusy`, que o consumidor converte em `Deferred` (`@wba/messaging`): a mensagem volta pela fila de retry **sem gastar tentativa**, porque ocupação não é falha (uma rajada de mensagens do mesmo aluno com o LLM lento esgotaria as tentativas e iria para a DLQ sem defeito nenhum). O limite é a idade, `CONSUMER_MAX_DEFER_MS` (10 min, header `x-deferred-since`); passado ele, vai para a DLQ com o motivo `deferred_too_long`. O lock evita trabalho duplicado do agente; **não é a garantia de correção**: se ele vencer no meio de um turno, o compare-and-set continua impedindo a gravação concorrente.
5. Também usam a caixa de saída as ações do painel que enviam mensagem ao aluno e salvam a Conversa: a resposta do atendente e a devolução ao bot. O aviso proativo (`NotifyStudent`) continua publicando antes de salvar, porque a sua reserva de idempotência (o ledger) é feita antes e um conflito de versão depois dela perderia o aviso; ele já é de baixo volume e idempotente por reserva.

## Consequências

- Nenhuma resposta sai de um turno que não foi salvo, e nenhum turno salvo perde a resposta (desde que o Redis persista; o compose usa AOF).
- O estado e a saída dependem do mesmo Redis e de um script que toca três chaves: funciona em instância única ou com *hash tags*, não em Redis Cluster sem ajuste. Trocar o Redis por um banco transacional mantém a porta (`ConversationRepository.save` com `OutboxEntry`).
- O lock **não garante ordem** entre mensagens do mesmo contato, só que não rodam juntas; com uma mensagem retida em retry e outra entregue, a segunda pode ser processada primeiro. A Conversa só aceita escolha entre as opções da última oferta, o que limita o estrago. Ordem estrita exigiria uma fila por partição de contato (single active consumer ou *consistent hash exchange*), com custo de topologia e de plugins que não se justifica no volume de um estúdio.
- A entrada da caixa carrega o telefone do aluno: expira em 7 dias se ninguém a publicar.
- O código do turno agora tem dois estados de falha de publicação visíveis (log `outbox_publish_failed` e a métrica), em vez de uma exceção que reenfileirava a mensagem inteira.

## Alternativas

- **Outbox em tabela relacional com a Conversa**: o desenho canônico, mas exigiria trocar a persistência da Conversa. O Redis já é o store da Conversa e o script Lua dá a atomicidade necessária.
- **Manter publicar-depois-salvar**: simples, mas com a duplicata no conflito de versão.
- **Fila por contato (single active consumer, hash consistente)**: ordem estrita, mas muda a topologia do RabbitMQ e exige plugin; deixado como evolução se o volume pedir.
- **Só o lock**, sem outbox: não resolve a queda entre publicar e salvar.
