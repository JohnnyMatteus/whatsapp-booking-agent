// Adaptador RabbitMQ (amqplib). Garantias (ADR 0006):
// - publicação em canal de confirmação: só retorna depois do ack do broker;
// - mensagens persistentes em filas quorum;
// - consumo com ack manual e prefetch limitado;
// - falha transitória vai para `<fila>.retry` (TTL) e volta para a fila; esgotou ou é
//   permanente, vai para `<fila>.dlq` com o motivo nos headers.
import { context, propagation } from '@opentelemetry/api';
import { EXCHANGE, parseEnvelope, type AnyEnvelope } from '@wba/contracts';
import { deadLetterQueueOf, retryQueueOf, type QueueSpec } from '@wba/contracts/topology';
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { decideOnFailure, DEFAULT_MAX_DEFER_MS } from './failure-policy.js';

export interface BusLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ConsumeOptions {
  readonly prefetch: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  /** Idade máxima de uma mensagem adiada por ocupação (`Deferred`) antes de ir para a DLQ. */
  readonly maxDeferMs?: number;
}

export type EnvelopeHandler = (envelope: AnyEnvelope) => Promise<void>;

export interface BusObserver {
  consumed(queue: string, result: 'ack' | 'retry' | 'dead_letter'): void;
}

const ATTEMPT_HEADER = 'x-attempt';
const DEFERRED_SINCE_HEADER = 'x-deferred-since';

export class RabbitMqBus {
  private constructor(
    private readonly connection: ChannelModel,
    private readonly channel: ConfirmChannel,
    private readonly logger: BusLogger,
    private readonly observer?: BusObserver,
  ) {}

  static async connect(url: string, logger: BusLogger, observer?: BusObserver): Promise<RabbitMqBus> {
    const connection = await amqp.connect(url);
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    connection.on('error', (error: Error) => logger.error({ err: error }, 'rabbitmq_connection_error'));
    return new RabbitMqBus(connection, channel, logger, observer);
  }

  /** Idempotente: declara fila, retry, DLQ e bindings. */
  async declareQueue(spec: QueueSpec, retryDelayMs: number): Promise<void> {
    const quorum = { 'x-queue-type': 'quorum' };
    await this.channel.assertQueue(spec.name, { durable: true, arguments: quorum });
    await this.channel.assertQueue(deadLetterQueueOf(spec.name), { durable: true, arguments: quorum });
    await this.channel.assertQueue(retryQueueOf(spec.name), {
      durable: true,
      arguments: {
        ...quorum,
        'x-message-ttl': retryDelayMs,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': spec.name,
      },
    });
    for (const type of spec.bindings) await this.channel.bindQueue(spec.name, EXCHANGE, type);
  }

  async publish(envelope: AnyEnvelope): Promise<void> {
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers);
    await new Promise<void>((resolve, reject) => {
      this.channel.publish(
        EXCHANGE,
        envelope.type,
        Buffer.from(JSON.stringify(envelope)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: envelope.id,
          correlationId: envelope.correlationId,
          type: envelope.type,
          headers,
        },
        (error) => (error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve()),
      );
    });
  }

  async consume(spec: QueueSpec, options: ConsumeOptions, handler: EnvelopeHandler): Promise<void> {
    await this.declareQueue(spec, options.retryDelayMs);
    await this.channel.prefetch(options.prefetch);
    await this.channel.consume(spec.name, (message) => {
      if (message) void this.handle(spec.name, message, options, handler);
    });
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }

  private async handle(queue: string, message: ConsumeMessage, options: ConsumeOptions, handler: EnvelopeHandler): Promise<void> {
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 1);
    const parent = propagation.extract(context.active(), message.properties.headers ?? {});
    try {
      const envelope = parseEnvelope(JSON.parse(message.content.toString('utf8')));
      await context.with(parent, () => handler(envelope));
      this.channel.ack(message);
      this.observer?.consumed(queue, 'ack');
    } catch (error) {
      const deferredSince = Number(message.properties.headers?.[DEFERRED_SINCE_HEADER] ?? Number.NaN);
      const decision = decideOnFailure(error, attempt, options.maxAttempts, {
        now: Date.now(),
        deferredSince: Number.isFinite(deferredSince) ? deferredSince : undefined,
        maxDeferMs: options.maxDeferMs ?? DEFAULT_MAX_DEFER_MS,
      });
      const target = decision.action === 'retry' ? retryQueueOf(queue) : deadLetterQueueOf(queue);
      const headers = {
        ...message.properties.headers,
        [ATTEMPT_HEADER]: decision.action === 'retry' ? decision.nextAttempt : attempt,
        ...(decision.action === 'retry' && decision.deferredSince !== undefined ? { [DEFERRED_SINCE_HEADER]: decision.deferredSince } : {}),
        ...(decision.action === 'dead_letter' ? { 'x-failure-reason': decision.reason, 'x-error': describe(error) } : {}),
      };
      try {
        // Reencaminha antes do ack: se cair entre os dois, a mensagem é reentregue (nunca perdida).
        await this.sendToQueue(target, message, headers);
        this.channel.ack(message);
      } catch (forwardError) {
        this.channel.nack(message, false, true);
        this.logger.error({ err: forwardError, queue }, 'rabbitmq_forward_failed');
        return;
      }
      const log = { queue, attempt, messageId: message.properties.messageId, err: error };
      if (decision.action === 'retry') this.logger.warn(log, 'message_retry_scheduled');
      else this.logger.error({ ...log, reason: decision.reason }, 'message_dead_lettered');
      this.observer?.consumed(queue, decision.action);
    }
  }

  private sendToQueue(queue: string, message: ConsumeMessage, headers: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.channel.sendToQueue(queue, message.content, { ...message.properties, headers, persistent: true }, (error) =>
        error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve(),
      );
    });
  }
}

function describe(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 512);
}
