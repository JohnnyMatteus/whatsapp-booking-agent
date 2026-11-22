// Composição do booking-agent: RabbitMQ → caso de uso → agente LangGraph → MCP/LLM → RabbitMQ.
import { Queues } from '@wba/contracts/topology';
import { RabbitMqBus } from '@wba/messaging';
import { createLogger, createMetricsRegistry, setupTracing } from '@wba/observability';
import { Redis } from 'ioredis';
import { createJwtVerifier, remoteKeys } from './adapters/http/auth.js';
import { buildPanelApi } from './adapters/http/server.js';
import { OpenAiCompatibleClient } from './adapters/llm/openai-compatible.js';
import { HttpThumbnailSource } from './adapters/media/http-thumbnails.js';
import { connectMcp } from './adapters/mcp/connect.js';
import { McpSchedulingTools } from './adapters/mcp/scheduling-tools.js';
import { createInboundHandler } from './adapters/messaging/consumer.js';
import { toEnvelopes } from './adapters/messaging/mapping.js';
import { RedisConversationLog, RedisConversationRepository, RedisContactLock, RedisHandoffQueue, RedisMediaNotes, RedisMetricsStore, RedisNoticeLedger, RedisOutbox } from './adapters/persistence/redis.js';
import { LangGraphConversationAgent } from './agent/graph.js';
import { HandleInboundMessage } from './application/handle-inbound.js';
import { MetricsRecorder } from './application/metrics-recorder.js';
import { OutboxRelay } from './application/outbox-relay.js';
import { NotifyStudent } from './application/notify-student.js';
import { PanelQueries } from './application/panel-queries.js';
import { ReminderScheduler } from './application/reminder-scheduler.js';
import { ReplyAsAttendant } from './application/reply-as-attendant.js';
import type { OutboundPublisher } from './application/ports.js';
import { ResumeConversation } from './application/resume-conversation.js';
import { loadConfig } from './config.js';
import { createAgentMetrics } from './telemetry.js';

const SERVICE = 'booking-agent';
const config = loadConfig();
const logger = createLogger(SERVICE);
const tracing = setupTracing(SERVICE, '0.1.0', config.OTEL_EXPORTER_OTLP_ENDPOINT);
const registry = createMetricsRegistry(SERVICE);
const metrics = createAgentMetrics(registry);
const clock = { now: () => new Date() };

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
const bus = await RabbitMqBus.connect(config.RABBITMQ_URL, logger, { consumed: (queue, result) => metrics.consumed.inc({ queue, result }) });
const mcp = await connectMcp(config.MCP_SERVER_URL, config.MCP_AUTH_TOKEN);

const conversations = new RedisConversationRepository(redis);
const handoffs = new RedisHandoffQueue(redis);
const log = new RedisConversationLog(redis);
const metricsStore = new RedisMetricsStore(redis);
const mediaNotes = new RedisMediaNotes(redis);
const recorder = new MetricsRecorder(metricsStore, config.STUDIO_TIMEZONE);
const publisher: OutboundPublisher = {
  async publish(messages, correlationId) {
    for (const envelope of toEnvelopes(messages, correlationId, clock.now())) await bus.publish(envelope);
    for (const message of messages) if (message.kind === 'handoff') metrics.handoffs.inc({ reason: message.ticket.reason });
  },
};

const tools = new McpSchedulingTools(mcp);
const agent = new LangGraphConversationAgent({
  tools,
  llm: new OpenAiCompatibleClient({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS }),
  clock,
  timezone: config.STUDIO_TIMEZONE,
  observer: metrics.observer,
});

const outbox = new RedisOutbox(redis);
const onOutboxError = (error: unknown) => logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'outbox_publish_failed');
const useCase = new HandleInboundMessage({ conversations, agent, publisher, outbox, onPublishError: onOutboxError, handoffs, log, metrics: recorder, clock });
await bus.consume(
  Queues.bookingAgent,
  { prefetch: config.CONSUMER_PREFETCH, maxAttempts: config.CONSUMER_MAX_ATTEMPTS, retryDelayMs: config.CONSUMER_RETRY_DELAY_MS },
  createInboundHandler({ useCase, metrics, recorder, mediaNotes, locks: new RedisContactLock(redis, { waitMs: config.CONTACT_LOCK_WAIT_MS }), logger, tracer: tracing.tracer }),
);
// A fila de atendimento existe mesmo sem consumidor dedicado: as mensagens ficam guardadas.
await bus.declareQueue(Queues.attendance, config.CONSUMER_RETRY_DELAY_MS);

// Varredor da caixa de saída: publica o que o turno não conseguiu publicar na hora (broker fora do ar, queda
// entre salvar e publicar). Roda também na subida, para esvaziar o que ficou de uma instância anterior.
const relay = new OutboxRelay({ outbox, publisher, onError: onOutboxError });
const sweepOutbox = () =>
  relay.sweep().then(
    async (sent) => {
      if (sent > 0) metrics.outboxPublished.inc(sent);
      metrics.outboxPending.set((await outbox.pending(100)).length);
    },
    (error: unknown) => logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'outbox_sweep_failed'),
  );
void sweepOutbox();
const outboxTimer = setInterval(() => void sweepOutbox(), config.OUTBOX_SWEEP_INTERVAL_MS);

const notify = new NotifyStudent({ tools, conversations, publisher, log, metrics: recorder, ledger: new RedisNoticeLedger(redis), clock, timezone: config.STUDIO_TIMEZONE });
const reminders = new ReminderScheduler({ log, conversations, notify, clock, onError: (error) => logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'reminder_skipped') });
const reminderTimer = setInterval(() => {
  for (const tenantId of config.REMINDER_TENANTS.split(',').map((t) => t.trim()).filter(Boolean)) {
    reminders.tick(tenantId).then(
      (sent) => sent > 0 && logger.info({ tenantId, sent }, 'reminders_sent'),
      (error: unknown) => logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'reminder_tick_failed'),
    );
  }
}, config.REMINDER_INTERVAL_MS);

const api = buildPanelApi({
  verifier: createJwtVerifier({ issuer: config.OIDC_ISSUER, audience: config.OIDC_AUDIENCE, keys: remoteKeys(config.OIDC_JWKS_URL) }),
  internalToken: config.INTERNAL_API_TOKEN,
  queries: new PanelQueries({ conversations, log, metrics: metricsStore, mediaNotes, thumbnails: new HttpThumbnailSource(config.MEDIA_PROCESSOR_URL, config.MEDIA_API_TOKEN), clock, timezone: config.STUDIO_TIMEZONE }),
  reply: new ReplyAsAttendant({ conversations, publisher, outbox, log, metrics: recorder, clock }),
  resume: new ResumeConversation({ conversations, handoffs, publisher, outbox, log, metrics: recorder, clock }),
  notify,
  registry,
});
await api.listen({ host: '0.0.0.0', port: config.PORT });
logger.info({ queue: Queues.bookingAgent.name, port: config.PORT }, 'booking_agent_started');

const shutdown = async () => {
  clearInterval(reminderTimer);
  clearInterval(outboxTimer);
  await api.close();
  await bus.close();
  await mcp.close();
  redis.disconnect();
  await tracing.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
