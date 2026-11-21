# ADR 0004: Transferência para humano

**Status:** Aceito

## Contexto

Há conversas que o bot não deve conduzir: o aluno pede uma pessoa, menciona saúde (dor, lesão, gravidez), financeiro (cobrança, reembolso) ou conflito (reclamação, Procon), ou o bot falha seguidamente (não entende, LLM fora, agenda fora). Continuar respondendo nesses casos irrita o aluno ou causa dano.

## Decisão

- Três motivos, modelados no domínio: `explicit_request`, `sensitive_topic` e `repeated_failure`.
- Pedido explícito e tema sensível são detectados pela política determinística (e o LLM também pode apontar `human` no caso ambíguo). Falha repetida é regra do agregado `Conversation`: na **2ª falha seguida** a conversa é transferida. Um acerto zera o contador; recusa de escopo e recusa de regra de negócio não contam como falha.
- Transferir muda o estado da Conversa para `handed_off`, apaga a oferta vigente e emite `handoff_requested` uma única vez (transferir de novo é no-op).
- Com a conversa transferida, `Conversation.receive` devolve `silenced`: a mensagem é registrada (deduplicação) e **o bot não responde nem chama o agente**.
- O booking-agent publica `attendance.handoff_requested` (fila `attendance.handoffs`) e coloca um ticket na fila de atendimento do estúdio (Redis), lida pelo painel.
- O atendente devolve a conversa ao bot pelo painel (`resumeBot`, contador zerado, ticket removido).
- A API do painel usa token provisório injetado pelo proxy e mostra o contato mascarado.

## Consequências

- A regra "bot para de responder" é invariante do domínio, testada sem LLM nem fila.
- Duas falhas é agressivo de propósito: é melhor uma pessoa assumir cedo do que o aluno repetir três vezes.
- Nesta rodada o atendente não responde pelo painel (caixa de entrada é próximo passo); o atendimento acontece pelos canais do estúdio.

## Alternativas

- **Transferência só por pedido explícito**: deixaria o bot opinando sobre dor e cobrança.
- **Contar recusas como falhas**: transferiria quem testa os limites do bot, enchendo a fila humana com conversas fora do escopo.
- **Bot continua respondendo em paralelo ao humano**: mensagens contraditórias para o aluno.
