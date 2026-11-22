// Consumidor da fila do agente: envelope → caso de uso → métricas e span.
import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { inSpan, type Logger } from '@wba/observability';
import type { Tracer } from '@opentelemetry/api';
import type { HandleInboundMessage } from '../../application/handle-inbound.js';
import type { MetricsRecorder } from '../../application/metrics-recorder.js';
import type { ContactLock, MediaNotes } from '../../application/ports.js';
import type { AgentMetrics } from '../../telemetry.js';
import { toInboundCommand } from './mapping.js';

export function createInboundHandler(deps: { useCase: HandleInboundMessage; metrics: AgentMetrics; recorder: MetricsRecorder; mediaNotes: MediaNotes; locks: ContactLock; logger: Logger; tracer: Tracer }) {
  return async (envelope: AnyEnvelope): Promise<void> => {
    if (envelope.type === MessageType.DeliveryStatusChanged) {
      deps.metrics.deliveryStatus.inc({ status: envelope.payload.status });
      if (envelope.payload.status === 'failed') await deps.recorder.deliveryFailure(envelope.payload.tenantId, new Date(envelope.payload.occurredAt));
      return;
    }
    if (envelope.type === MessageType.MediaProcessed) {
      const { tenantId, messageId, kind, status, rejectionReason, transcribed, thumbnailKey } = envelope.payload;
      await deps.mediaNotes.save(tenantId, messageId, { kind, status, rejectionReason: rejectionReason ?? null, transcribed, thumbnailKey: thumbnailKey ?? null });
      return;
    }
    const command = toInboundCommand(envelope);
    if (!command) return;

    // Uma mensagem por contato de cada vez, em todas as instâncias; quem não consegue a vez em tempo volta pela
    // fila de retry (ContactBusy). O compare-and-set da conversa segue como rede de segurança.
    await deps.locks.withLock(command.tenantId, command.contactId, async () => {
      const stop = deps.metrics.turnDuration.startTimer();
      await inSpan(deps.tracer, 'booking_agent.turn', { 'wba.correlation_id': envelope.correlationId, 'wba.turn_kind': command.turn.kind }, async () => {
        const outcome = await deps.useCase.execute(command);
        deps.metrics.turns.inc({ outcome });
        deps.logger.info({ correlationId: envelope.correlationId, tenantId: command.tenantId, outcome }, 'turn_processed');
      }).finally(stop);
    });
  };
}
