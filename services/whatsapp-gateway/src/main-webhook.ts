// Processo do webhook: HTTP de entrada → Redis (idempotência) → RabbitMQ.
import { createLogger, createMetricsRegistry, setupTracing } from '@wba/observability';
import { RabbitMqBus } from '@wba/messaging';
import { Redis } from 'ioredis';
import { RedisIdempotencyStore } from './adapters/redis-idempotency.js';
import { StaticTenantDirectory } from './adapters/tenant-directory.js';
import { loadConfig } from './config.js';
import { createGatewayMetrics } from './telemetry.js';
import { buildWebhookServer } from './webhook/server.js';

const SERVICE = 'whatsapp-webhook';
const config = loadConfig();
const logger = createLogger(SERVICE);
const tracing = setupTracing(SERVICE, '0.1.0', config.OTEL_EXPORTER_OTLP_ENDPOINT);
const registry = createMetricsRegistry(SERVICE);
const metrics = createGatewayMetrics(registry);

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
const bus = await RabbitMqBus.connect(config.RABBITMQ_URL, logger);

const app = buildWebhookServer({
  appSecret: config.WHATSAPP_APP_SECRET,
  verifyToken: config.WHATSAPP_VERIFY_TOKEN,
  tenants: StaticTenantDirectory.fromJson(config.TENANT_PHONE_NUMBERS),
  idempotency: new RedisIdempotencyStore(redis),
  publisher: bus,
  clock: { now: () => new Date() },
  logger,
  metrics,
  registry,
  isReady: () => redis.status === 'ready',
});

await app.listen({ host: '0.0.0.0', port: config.PORT });
logger.info({ port: config.PORT }, 'webhook_listening');

const shutdown = async () => {
  logger.info({}, 'shutting_down');
  await app.close();
  await bus.close();
  redis.disconnect();
  await tracing.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
