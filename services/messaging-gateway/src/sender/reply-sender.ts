// Sender: consome respostas da fila e envia pelo provedor do estúdio (porta MessagingProvider).
// Retry e DLQ ficam no consumidor RabbitMQ (@wba/messaging): aqui só se escolhe o provedor.
import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import type { Logger } from '@wba/observability';
import type { ProviderRegistry } from '../registry.js';
import type { GatewayMetrics } from '../telemetry.js';

export class ReplySender {
  constructor(private readonly deps: { providers: Pick<ProviderRegistry, 'forTenant'>; logger: Logger; metrics: GatewayMetrics }) {}

  async handle(envelope: AnyEnvelope): Promise<void> {
    if (envelope.type !== MessageType.ReplyRequested) {
      throw new PermanentFailure(`sender não trata ${envelope.type}`);
    }
    const reply = envelope.payload;
    const provider = this.deps.providers.forTenant(reply.tenantId);
    if (provider === null) throw new PermanentFailure(`estúdio sem canal configurado: ${reply.tenantId}`);

    const stop = this.deps.metrics.providerLatency.startTimer({ provider: provider.id });
    try {
      const { messageId } = await provider.send(reply);
      this.deps.metrics.outboundMessages.inc({ provider: provider.id, result: 'sent' });
      this.deps.logger.info({ correlationId: envelope.correlationId, provider: provider.id, outboundMessageId: messageId, kind: reply.content.kind }, 'reply_sent');
    } catch (error) {
      this.deps.metrics.outboundMessages.inc({ provider: provider.id, result: error instanceof PermanentFailure ? 'permanent_error' : 'transient_error' });
      throw error;
    } finally {
      stop();
    }
  }
}
