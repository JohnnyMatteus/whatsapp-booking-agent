// Consumidor da fila do agente: envelope → caso de uso → métricas e span.
import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { inSpan, type Logger } from '@wba/observability';
import type { Tracer } from '@opentelemetry/api';
import type { HandleInboundMessage } from '../../application/handle-inbound.js';
import type { AgentMetrics } from '../../telemetry.js';
import { toInboundCommand } from './mapping.js';

export function createInboundHandler(deps: { useCase: HandleInboundMessage; metrics: AgentMetrics; logger: Logger; tracer: Tracer }) {
  return async (envelope: AnyEnvelope): Promise<void> => {
    if (envelope.type === MessageType.DeliveryStatusChanged) {
      deps.metrics.deliveryStatus.inc({ status: envelope.payload.status });
      return;
    }
    const command = toInboundCommand(envelope);
    if (!command) return;

    const stop = deps.metrics.turnDuration.startTimer();
    await inSpan(deps.tracer, 'booking_agent.turn', { 'wba.correlation_id': envelope.correlationId, 'wba.turn_kind': command.turn.kind }, async () => {
      const outcome = await deps.useCase.execute(command);
      deps.metrics.turns.inc({ outcome });
      deps.logger.info({ correlationId: envelope.correlationId, tenantId: command.tenantId, outcome }, 'turn_processed');
    }).finally(stop);
  };
}
