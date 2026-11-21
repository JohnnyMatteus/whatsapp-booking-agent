# Roteiro: modelo de domínio do contexto de Agendamento

Núcleo: os agregados Aula, Reserva, ListaDeEspera e Conversa, com invariantes no domínio e sem dependência de framework; e a fronteira com o SaaS e com a Meta.

Código: `services/booking-agent/src/domain/` (`class-session.ts`, `booking.ts`, `waitlist.ts`, `conversation.ts`, `errors.ts`, `scope-policy.ts`). Testes: `tests/domain/`. ACLs: [ADR 0002](../adr/0002-anti-corruption-layer.md).

## O problema

O SaaS já tem um modelo de agenda (turmas, sessões, reservas, fila). Por que o bot precisa de outro? Porque o **contexto é diferente**: o SaaS é o sistema de registro do estúdio; o bot é um canal de conversa com o aluno. Conceitos com o mesmo nome têm regras e informação diferentes em cada lado. Exemplos:

- No SaaS, reservar aula lotada coloca o aluno na fila. Na conversa, isso precisa ser uma escolha explícita do aluno.
- No SaaS, a fila é uma lista ordenada de pessoas. O aluno, pela API, só vê o tamanho da fila e a própria reserva.
- No SaaS não existe "oferta". Na conversa, o aluno só pode escolher o que acabou de ver.

## A solução

### Aula (`ClassSession`)

Uma ocorrência da grade como o aluno a enxerga. Invariantes checadas em `create`: fim depois do início, fuso IANA válido, capacidade inteira positiva, confirmados entre 0 e a capacidade, **fila só existe com aula lotada** (fila com vaga sobrando é dado incoerente). Comportamentos: `availableSpots`, `isFull`, `hasStartedAt` (no horário de início já começou, mesma regra do SaaS), `bookingOutcomeAt` (vaga ou fila) e `assertWaitlistOpenAt` (fila só em aula lotada). Datas são copiadas na entrada e na saída: ninguém altera o horário por referência.

### Reserva (`Booking`)

Estados `confirmed`, `waitlisted`, `canceled`. Transições: cancelar (não duas vezes, não depois do início; cancelar vaga confirmada **libera lugar**, cancelar posição na fila não) e promover (só quem está na fila). A janela de cancelamento é configurada por estúdio e só o SaaS a conhece: ela volta pela ACL como `cancellation_window_closed`. O domínio valida o que sabe, o SaaS valida o resto, e o erro do SaaS tem tradução explícita.

### Lista de espera (`Waitlist`)

Aqui está a decisão de modelagem mais interessante. O SaaS é dono da fila completa; ao aluno, expõe o tamanho (`waitlist_count`) e a própria reserva. Em vez de fingir que temos a fila inteira, o agregado modela **exatamente o que o contexto sabe**: o tamanho, se o aluno está nela, e as regras de entrada (aula lotada e não começada, aluno fora da fila e sem vaga). FIFO: quem entra fica atrás de todos, então a posição informada é `tamanho + 1`, válida no instante da entrada.

### Conversa (`Conversation`)

O agregado mais rico, porque é o que só existe neste contexto:

- **Deduplicação**: guarda os últimos 50 ids processados (`receive` devolve `process`, `duplicate` ou `silenced`).
- **Oferta**: `offerSlots` guarda a fotografia das aulas que o aluno viu (é a única fonte de horários que o bot pode citar). `offeredSlot` e `offeredBooking` só aceitam escolha da última oferta e por 30 minutos: depois disso as vagas podem ter mudado. Cancelar só reserva do próprio aluno que apareceu na oferta.
- **Falhas e transferência**: ver o roteiro de [transferência para humano](transferencia-para-humano.md).
- **Eventos**: `handoff_requested` e `bot_resumed`, coletados com `pullEvents` e traduzidos pela aplicação para a fila depois do processamento.
- **Snapshot e versão**: o repositório grava com compare-and-set pela versão.

### Erros

`DomainError` com `code` estável (`class_session_full`, `overlapping_booking`, `slot_not_offered`...) e `retryable` só para indisponibilidade da agenda. O agente escolhe a resposta ao aluno pelo código, nunca pelo texto.

### Fronteiras

```
Meta (webhook)  --ACL WhatsApp-->  linguagem publicada  -->  aplicação  -->  domínio
SaaS (REST)     --ACL SaaS (Go)--> ferramentas MCP  --2ª barreira (TS)--> agregados
```

Nenhum tipo da Meta ou do SaaS entra em `src/domain`; o ESLint bloqueia imports de framework, fila, LLM e até do pacote de contratos dentro do domínio.

## Alternativas e trade-offs

| Opção | Por que não (ou por que sim) |
| --- | --- |
| Usar o modelo do SaaS direto | menos código; mas a regra da fila silenciosa e o formato do SaaS vazariam para a conversa |
| Bot sem domínio, só chamando a API | as regras ("só escolhe o que viu", "transferida não fala") ficariam espalhadas no agente e dependeriam do LLM |
| Duplicar todas as regras do SaaS | inconsistência garantida; o domínio valida só o que o contexto sabe e traduz o resto |
| Lista de espera com a fila completa | o contexto não tem esse dado; modelar o que não se sabe gera bugs silenciosos |
| Agregados imutáveis (Aula, Reserva) e Conversa com estado interno | Aula e Reserva são fotografias trocadas por valor; a Conversa acumula eventos dentro de um turno e é salva uma vez |

## Perguntas de entrevista

**Isso não é duplicar o domínio do SaaS?**
Não, é outro contexto delimitado. Mesmo nome, outra responsabilidade: o SaaS registra; a conversa decide o que oferecer, o que aceitar e quando parar. As regras duplicadas são poucas e de propósito (não oferecer aula começada evita uma ida ao SaaS e uma resposta confusa). A autoridade continua no SaaS, e os erros dele têm tradução explícita.

**Por que a Lista de espera não tem a lista de pessoas?**
Porque o contexto não tem esse dado: a API do aluno expõe só o tamanho e a própria reserva. O agregado modela o que sabemos. Inventar a lista seria um modelo que mente.

**O que acontece se o SaaS devolver uma aula com 13 confirmados e capacidade 12?**
A segunda barreira da ACL reconstrói a aula com `ClassSession.create`, que lança `invalid_class_session`. O bot trata como falha (não mostra dado incoerente ao aluno), e o servidor MCP já limita confirmados à capacidade na tradução.

**Por que a oferta expira em 30 minutos?**
Vagas mudam. Uma oferta velha pode mostrar vaga que acabou. Expirada, o aluno pede os horários de novo e recebe a foto atual. É um equilíbrio entre conveniência e consistência, ajustável por constante.

**Como você testa isso?**
Testes unitários puros em `tests/domain/` (invariantes, transições, bordas como "exatamente no horário de início"), sem mocks. Os testes do agente e do caso de uso usam o domínio de verdade com portas falsas.

**Onde ficam as regras que dependem de tempo?**
Todo método recebe `now` explicitamente; o relógio é uma porta (`Clock`) da aplicação. O domínio nunca lê o relógio, então os testes controlam o tempo.
