// Processo do sender: fila de respostas → ACL de saída → Cloud API, com retry e DLQ.
import { Queues } from '@wba/contracts/topology';
import { RabbitMqBus } from '@wba/messaging';
import { createLogger, createMetricsRegistry, setupTracing } from '@wba/observability';
import Fastify from 'fastify';
import { HttpCloudApiClient } from './adapters/cloud-api-http.js';
import { StaticTenantDirectory } from './adapters/tenant-directory.js';
import { loadConfig } from './config.js';
import { ReplySender } from './sender/reply-sender.js';
import { createGatewayMetrics } from './telemetry.js';

const SERVICE = 'whatsapp-sender';
const config = loadConfig();
const logger = createLogger(SERVICE);
const tracing = setupTracing(SERVICE, '0.1.0', config.OTEL_EXPORTER_OTLP_ENDPOINT);
const registry = createMetricsRegistry(SERVICE);
const metrics = createGatewayMetrics(registry);

const sender = new ReplySender({
  cloudApi: new HttpCloudApiClient({
    baseUrl: config.WHATSAPP_API_BASE_URL,
    apiVersion: config.WHATSAPP_API_VERSION,
    accessToken: config.WHATSAPP_ACCESS_TOKEN,
    timeoutMs: 10_000,
  }),
  tenants: StaticTenantDirectory.fromJson(config.TENANT_PHONE_NUMBERS),
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
  await tracing.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
