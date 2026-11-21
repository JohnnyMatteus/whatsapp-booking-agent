# ADR 0008: Agente LangGraph como adapter de aplicação

**Status:** Aceito

## Contexto

O agente precisa entender linguagem natural, mas não pode inventar horários, ids de aula nem identidade do aluno, e precisa ser testável sem LLM real. Um agente ReAct livre (o LLM escolhe e chama ferramentas) dá flexibilidade e tira as garantias.

## Decisão

- O agente é um **adapter de aplicação** que implementa a porta `ConversationAgent`; o caso de uso não conhece LangGraph.
- **Grafo com nós fixos**: `screen` (política determinística) → `interpret` (LLM, só no ambíguo) → `act` (código chama as ferramentas) → `compose` (LLM escreve só a frase de abertura) → `finalize`; com desvios para `refuse`, `handoff` e `fail`.
- **O LLM nunca chama ferramentas** e nunca preenche identidade: `estudio` e `contato` vêm da Conversa.
- **Toda saída de LLM é validada por schema Zod, com exatamente um retry** que devolve ao modelo o motivo da rejeição. O schema é montado por turno: o LLM só pode apontar uma aula que foi oferecida.
- **Citação garantida por código** (`citation-guard.ts`), em duas barreiras: (1) o texto do LLM não pode conter data nem hora (os horários são renderizados pelo código a partir dos dados das ferramentas); (2) antes de publicar, toda resposta é varrida e cada data ou hora precisa pertencer a uma aula devolvida pelas ferramentas neste turno ou oferecida na conversa; se não pertencer, a resposta é trocada por uma mensagem segura e a métrica `wba_citation_violations_total` sobe (com alerta).
- Os testes usam um **cliente LLM falso roteirizado** que falha se o grafo chamar o modelo mais vezes do que o previsto.

## Consequências

- `tests/agent/slot-citation.test.ts` prova a garantia: horário inventado pelo LLM é rejeitado, o retry acontece, a resposta cai para o texto fixo e todas as horas finais pertencem às ferramentas; o LLM não consegue reservar aula não oferecida.
- O LLM tem papel pequeno (classificar e uma frase), o que reduz custo e permite modelo pequeno local.
- Menos flexível para pedidos compostos ("cancela a de terça e me coloca na de quarta"): exigem dois turnos.

## Alternativas

- **ReAct com tool calling livre**: mais natural, mas o modelo pode inventar ids e horários e chamar ferramentas com argumentos errados; garantias passariam a depender do prompt.
- **Sem LLM**: previsível, mas frases ambíguas virariam "não entendi" com frequência.
- **Validar só a resposta final**: pegaria o horário inventado, mas sem retry nem schema por etapa o bot falharia mais vezes.
