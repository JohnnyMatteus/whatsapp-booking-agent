// Métricas do booking-agent (Prometheus).
import { Counter, Gauge, Histogram, type Registry } from '@wba/observability';
import type { AgentObserver } from './agent/graph.js';

export function createAgentMetrics(registry: Registry) {
  const turns = new Counter({
    name: 'wba_agent_turns_total',
    help: 'Turnos de conversa por resultado (answered, refused, handed_off, failed, duplicate, silenced).',
    labelNames: ['outcome'] as const,
    registers: [registry],
  });
  const handoffs = new Counter({
    name: 'wba_handoffs_total',
    help: 'Transferências para humano por motivo.',
    labelNames: ['reason'] as const,
    registers: [registry],
  });
  const llmRejections = new Counter({
    name: 'wba_llm_output_rejected_total',
    help: 'Saídas do LLM rejeitadas mesmo após o retry, por etapa.',
    labelNames: ['stage'] as const,
    registers: [registry],
  });
  const citationViolations = new Counter({
    name: 'wba_citation_violations_total',
    help: 'Respostas trocadas pela mensagem segura por citar data ou hora fora das ferramentas.',
    registers: [registry],
  });
  const turnDuration = new Histogram({
    name: 'wba_agent_turn_seconds',
    help: 'Duração do processamento de uma mensagem (carregar, agente, publicar, salvar).',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [registry],
  });
  const consumed = new Counter({
    name: 'wba_queue_messages_total',
    help: 'Mensagens consumidas por fila e destino (ack, retry, dead_letter).',
    labelNames: ['queue', 'result'] as const,
    registers: [registry],
  });
  const deliveryStatus = new Counter({
    name: 'wba_delivery_status_total',
    help: 'Status de entrega reportados pela Cloud API.',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  const outboxPending = new Gauge({
    name: 'wba_outbox_pending',
    help: 'Entradas da caixa de saída ainda não publicadas (até o limite de uma varredura). Acima de zero por muito tempo: broker fora ou publicação falhando.',
    registers: [registry],
  });
  const outboxPublished = new Counter({
    name: 'wba_outbox_swept_total',
    help: 'Entradas publicadas pelo varredor da caixa de saída (as que o turno não conseguiu publicar na hora).',
    registers: [registry],
  });

  const observer: AgentObserver = {
    turnFinished: ({ citationViolations: violations }) => citationViolations.inc(violations),
    llmRejected: (stage) => llmRejections.inc({ stage }),
  };

  return { turns, handoffs, turnDuration, consumed, deliveryStatus, outboxPending, outboxPublished, observer };
}

export type AgentMetrics = ReturnType<typeof createAgentMetrics>;
