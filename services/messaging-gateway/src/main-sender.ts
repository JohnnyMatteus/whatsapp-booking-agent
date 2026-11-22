// Processo do sender: fila de respostas → ACL de saída do provedor do estúdio, com retry e DLQ.
import { Queues } from '@wba/contracts/topology';
import { RabbitMqBus } from '@wba/messaging';
import { createLogger, createMetricsRegistry, setupTracing } from '@wba/observability';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { RedisMediaCache } from './adapters/redis-media-cache.js';
import { buildProviders } from './composition.js';
import { loadConfig } from './config.js';
import { ReplySender } from './sender/reply-sender.js';
import { createGatewayMetrics } from './telemetry.js';

const SERVICE = 'messaging-sender';
const config = loadConfig();
const logger = createLogger(SERVICE);
const tracing = setupTracing(SERVICE, '0.1.0', config.OTEL_EXPORTER_OTLP_ENDPOINT);
const registry = createMetricsRegistry(SERVICE);
const metrics = createGatewayMetrics(registry);

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
const sender = new ReplySender({
  // O sender nunca recebe webhook: o cache de mídia existe só para satisfazer a composição.
  providers: buildProviders(config, new RedisMediaCache(redis)),
  logger,
  metrics,
});

const bus = await RabbitMqBus.connect(config.RABBITMQ_URL, logger, {
  consumed: (queue, result) => metrics.consumed.inc({ queue, result }),
});
await bus.consume(
  Queues.sender,
  { prefetch: 10, maxAttempts: config.SENDER_MAX_ATTEMPTS, retryDelayMs: config.SENDER_RETRY_DELAY_MS },
  (envelope) => sender.handle(envelope),
);

// Só saúde e métricas: o sender não recebe tráfego HTTP.
const http = Fastify();
http.get('/healthz', async () => ({ status: 'ok' }));
http.get('/metrics', async (_request, reply) => reply.type(registry.contentType).send(await registry.metrics()));
await http.listen({ host: '0.0.0.0', port: config.PORT });
logger.info({ queue: Queues.sender.name }, 'sender_consuming');

const shutdown = async () => {
  await http.close();
  await bus.close();
  redis.disconnect();
  await tracing.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
