// Integração (só no CI): webhook → Redis real (idempotência) → RabbitMQ real (fila do agente),
// e o caminho de falha do consumidor até a DLQ.
import { createEnvelope, MessageType } from '@wba/contracts';
import { deadLetterQueueOf, Queues } from '@wba/contracts/topology';
import { PermanentFailure, RabbitMqBus } from '@wba/messaging';
import { createLogger, createMetricsRegistry } from '@wba/observability';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import amqp from 'amqplib';
import { Redis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisIdempotencyStore } from '../../src/adapters/redis-idempotency.js';
import { StaticTenantDirectory } from '../../src/adapters/tenant-directory.js';
import { createGatewayMetrics } from '../../src/telemetry.js';
import { buildWebhookServer } from '../../src/webhook/server.js';
import { signBody } from '../../src/webhook/signature.js';

const SECRET = 'dev-only-change-me-app-secret';
const logger = createLogger('it', 'silent');
let rabbit: StartedRabbitMQContainer;
let redisContainer: StartedRedisContainer;
let redis: Redis;
let bus: RabbitMqBus;

async function drain(url: string, queue: string): Promise<unknown[]> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  const found: unknown[] = [];
  for (let i = 0; i < 20; i++) {
    const message = await channel.get(queue, { noAck: true });
    if (message) found.push(JSON.parse(message.content.toString()));
    else if (found.length > 0) break;
    else await new Promise((r) => setTimeout(r, 250));
  }
  await connection.close();
  return found;
}

beforeAll(async () => {
  [rabbit, redisContainer] = await Promise.all([
    new RabbitMQContainer('rabbitmq:4.1.4-management-alpine').start(),
    new RedisContainer('redis:7.4.6-alpine').start(),
  ]);
  redis = new Redis(redisContainer.getConnectionUrl());
  bus = await RabbitMqBus.connect(rabbit.getAmqpUrl(), logger);
  await bus.declareQueue(Queues.bookingAgent, 1000);
});

afterAll(async () => {
  await bus?.close();
  redis?.disconnect();
  await Promise.all([rabbit?.stop(), redisContainer?.stop()]);
});

describe('webhook com Redis e RabbitMQ reais', () => {
  it('publica uma vez na fila do agente mesmo com a Meta reentregando', async () => {
    const registry = createMetricsRegistry('it');
    const app = buildWebhookServer({
      appSecret: SECRET,
      verifyToken: 'dev-only-verify-token',
      tenants: new StaticTenantDirectory(new Map([['100000000000001', 'estudio-lotus']])),
      idempotency: new RedisIdempotencyStore(redis),
      publisher: bus,
      clock: { now: () => new Date() },
      logger,
      metrics: createGatewayMetrics(registry),
      registry,
    });
    const body = readFileSync(new URL('../contract/fixtures/inbound/text-message.json', import.meta.url));
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signBody(body, SECRET) };

    const first = await app.inject({ method: 'POST', url: '/webhook', payload: body, headers });
    const second = await app.inject({ method: 'POST', url: '/webhook', payload: body, headers });

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const messages = await drain(rabbit.getAmqpUrl(), Queues.bookingAgent.name);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: MessageType.MessageReceived, payload: { tenantId: 'estudio-lotus' } });
  });

  it('falha permanente no consumidor manda a mensagem para a DLQ com o motivo', async () => {
    const spec = { name: 'it.permanent', bindings: [MessageType.ReplyRequested] } as const;
    await bus.consume(spec, { prefetch: 1, maxAttempts: 3, retryDelayMs: 200 }, async () => {
      throw new PermanentFailure('número inválido');
    });

    await bus.publish(
      createEnvelope(
        MessageType.ReplyRequested,
        { tenantId: 'estudio-lotus', contactId: '5511900000001', content: { kind: 'text', text: 'oi' } },
        { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000003', correlationId: 'wamid.IT', occurredAt: new Date() },
      ),
    );

    const dead = await drain(rabbit.getAmqpUrl(), deadLetterQueueOf(spec.name));
    expect(dead).toHaveLength(1);
  });

  it('falha transitória passa pela fila de retry e esgota as tentativas antes da DLQ', async () => {
    const spec = { name: 'it.transient', bindings: [MessageType.HandoffRequested] } as const;
    let attempts = 0;
    await bus.consume(spec, { prefetch: 1, maxAttempts: 3, retryDelayMs: 200 }, async () => {
      attempts++;
      throw new Error('timeout');
    });

    await bus.publish(
      createEnvelope(
        MessageType.HandoffRequested,
        { tenantId: 'estudio-lotus', conversationId: 'estudio-lotus:5511900000001', contactId: '5511900000001', reason: 'explicit_request', requestedAt: new Date().toISOString() },
        { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000004', correlationId: 'wamid.IT2', occurredAt: new Date() },
      ),
    );

    await expect.poll(() => attempts, { timeout: 10_000 }).toBe(3);
    expect(await drain(rabbit.getAmqpUrl(), deadLetterQueueOf(spec.name))).toHaveLength(1);
  });
});
