// Sender: consome respostas da fila, traduz pela ACL e envia à Cloud API.
// Retry e DLQ ficam no consumidor RabbitMQ (@wba/messaging): aqui só se classifica o erro.
import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import type { Logger } from '@wba/observability';
import { translateReply } from '../acl/outbound/translate-reply.js';
import type { StaticTenantDirectory } from '../adapters/tenant-directory.js';
import type { CloudApiClient } from '../ports.js';
import type { GatewayMetrics } from '../telemetry.js';

export class ReplySender {
  constructor(
    private readonly deps: { cloudApi: CloudApiClient; tenants: Pick<StaticTenantDirectory, 'phoneNumberFor'>; logger: Logger; metrics: GatewayMetrics },
  ) {}

  async handle(envelope: AnyEnvelope): Promise<void> {
    if (envelope.type !== MessageType.ReplyRequested) {
      throw new PermanentFailure(`sender não trata ${envelope.type}`);
    }
    const reply = envelope.payload;
    const phoneNumberId = this.deps.tenants.phoneNumberFor(reply.tenantId);
    if (phoneNumberId === null) throw new PermanentFailure(`estúdio sem número configurado: ${reply.tenantId}`);

    const stop = this.deps.metrics.cloudApiLatency.startTimer();
    try {
      const { messageId } = await this.deps.cloudApi.send(phoneNumberId, translateReply(reply));
      this.deps.metrics.outboundMessages.inc({ result: 'sent' });
      this.deps.logger.info({ correlationId: envelope.correlationId, outboundMessageId: messageId, kind: reply.content.kind }, 'reply_sent');
    } catch (error) {
      this.deps.metrics.outboundMessages.inc({ result: error instanceof PermanentFailure ? 'permanent_error' : 'transient_error' });
      throw error;
    } finally {
      stop();
    }
  }
}
