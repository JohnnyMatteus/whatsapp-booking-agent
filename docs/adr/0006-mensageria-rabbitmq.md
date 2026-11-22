# ADR 0006: Mensageria com RabbitMQ

**Status:** Aceito

## Contexto

Os serviços trocam comandos (mensagem recebida, pedido de reserva), respostas a enviar e pedidos de transferência. O padrão é fila de trabalho: cada mensagem tem um consumidor responsável, precisa de retry com atraso e de DLQ para o que não tem conserto. Não há necessidade de replay de histórico.

## Decisão

- **Um exchange topic durável** (`wba.events`); a routing key é o `type` do envelope. Publicar só exige o exchange; cada consumidor declara sua fila e seus bindings (`packages/contracts/src/topology.ts`).
- **Filas quorum** e mensagens persistentes; **publisher confirms** (a publicação só retorna depois do ack do broker).
- **Consumo com ack manual** e prefetch limitado.
- **Retry com TTL**: falha transitória envia a mensagem para `<fila>.retry` (TTL configurável), que faz dead-letter de volta para a fila original; o número da tentativa vai no header `x-attempt`.
- **DLQ** `<fila>.dlq`: depois do limite de tentativas, ou direto para mensagem fora do contrato (`ContractViolation`) e falha permanente (`PermanentFailure`), com motivo e erro nos headers.
- Reencaminhar antes do ack: se o processo cair entre os dois, a mensagem é reentregue, nunca perdida.
- Envelope versionado (`version: 1`) validado por schema na entrada de cada consumidor.

## Consequências

- O sender trata limite de taxa da Meta com retry sem bloquear a fila; erros definitivos não ficam girando.
- A decisão de destino (`decideOnFailure`) é função pura testada sem broker; o caminho real (retry até a DLQ) é testado com RabbitMQ em testcontainers no CI.
- Ordem por contato não é garantida com vários consumidores: a Conversa resolve corrida com compare-and-set e retry. O ADR 0014 acrescenta um lock por contato (uma mensagem do aluno por vez, sem garantia de ordem) e a caixa de saída.

## Alternativas

- **Kafka**: bom para log de eventos e replay, mas retry com atraso e DLQ por consumidor exigiriam tópicos extras e mais código; o volume de um estúdio não justifica.
- **Redis Streams**: menos peças (Redis já existe), mas sem DLQ e TTL de retry nativos.
- **Retry com `nack` e requeue**: sem atraso, vira laço quente contra uma Cloud API limitando taxa.
