# ADR 0005: Idempotência pelo id da mensagem

**Status:** Aceito. A ordem "publicar e depois salvar" foi substituída pela caixa de saída do ADR 0014.

## Contexto

A Meta entrega webhooks "pelo menos uma vez" e reentrega por até 7 dias quando não recebe 200. O RabbitMQ também entrega pelo menos uma vez (redelivery após falha do consumidor). Sem idempotência, o aluno recebe respostas duplicadas e, pior, o bot pode reservar duas vezes.

## Decisão

Duas camadas, ambas pelo id da mensagem do WhatsApp (`wamid`):

1. **Webhook (principal)**: `SET wba:webhook:seen:<id> NX EX 7d` no Redis antes de publicar. Para status de entrega a chave é `id + status` (entregue e lido são eventos distintos da mesma mensagem). Se a publicação falhar, a chave é liberada e o webhook responde 500 para a Meta reentregar.
2. **Conversa (defesa em profundidade)**: o agregado guarda os últimos 50 ids processados; `receive` devolve `duplicate` para repetidos, e o caso de uso não chama o agente.

No booking-agent, a Conversa e as saídas do turno são salvas juntas (caixa de saída, ADR 0014) e publicadas depois. O texto abaixo, de antes, descreve o desenho anterior (publicar e depois salvar).

## Consequências

- Reentrega da Meta não gera trabalho duplicado; o TTL de 7 dias cobre a janela de reentrega.
- Se o processo cair entre publicar e salvar, a redelivery responde de novo: uma duplicata rara, preferida à perda da resposta. As ferramentas também protegem o caso crítico: reservar de novo devolve `reserva_duplicada` no SaaS, e o aluno recebe "você já tem reserva".
- O webhook depende do Redis para aceitar mensagens; Redis fora = 500 e a Meta reentrega depois.

## Alternativas

- **Outbox transacional** (salvar a Conversa e as saídas juntas e publicar depois): adotado no ADR 0014, com o script Lua do Redis fazendo o papel da transação.
- **Deduplicar só no consumidor**: o webhook publicaria duplicatas na fila, gastando processamento e LLM.
- **Deduplicar pelo hash do corpo**: a Meta pode reenviar o mesmo evento com corpo diferente (lotes distintos); o id é o identificador estável.
