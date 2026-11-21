// Composição do booking-agent: RabbitMQ → caso de uso → agente LangGraph → MCP/LLM → RabbitMQ.
import { Queues } from '@wba/contracts/topology';
import { RabbitMqBus } from '@wba/messaging';
import { createLogger, createMetricsRegistry, setupTracing } from '@wba/observability';
import { Redis } from 'ioredis';
import { buildPanelApi } from './adapters/http/server.js';
import { OpenAiCompatibleClient } from './adapters/llm/openai-compatible.js';
import { connectMcp } from './adapters/mcp/connect.js';
import { McpSchedulingTools } from './adapters/mcp/scheduling-tools.js';
import { createInboundHandler } from './adapters/messaging/consumer.js';
import { toEnvelopes } from './adapters/messaging/mapping.js';
import { RedisConversationRepository, RedisHandoffQueue } from './adapters/persistence/redis.js';
import { LangGraphConversationAgent } from './agent/graph.js';
import { HandleInboundMessage } from './application/handle-inbound.js';
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
const publisher: OutboundPublisher = {
  async publish(messages, correlationId) {
    for (const envelope of toEnvelopes(messages, correlationId, clock.now())) await bus.publish(envelope);
    for (const message of messages) if (message.kind === 'handoff') metrics.handoffs.inc({ reason: message.ticket.reason });
  },
};

const agent = new LangGraphConversationAgent({
  tools: new McpSchedulingTools(mcp),
  llm: new OpenAiCompatibleClient({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS }),
  clock,
  timezone: config.STUDIO_TIMEZONE,
  observer: metrics.observer,
});

const useCase = new HandleInboundMessage({ conversations, agent, publisher, handoffs, clock });
await bus.consume(
  Queues.bookingAgent,
  { prefetch: config.CONSUMER_PREFETCH, maxAttempts: config.CONSUMER_MAX_ATTEMPTS, retryDelayMs: config.CONSUMER_RETRY_DELAY_MS },
  createInboundHandler({ useCase, metrics, logger, tracer: tracing.tracer }),
);
// A fila de atendimento existe mesmo sem consumidor dedicado: as mensagens ficam guardadas.
await bus.declareQueue(Queues.attendance, config.CONSUMER_RETRY_DELAY_MS);

const api = buildPanelApi({ token: config.PANEL_API_TOKEN, handoffs, resume: new ResumeConversation({ conversations, handoffs, clock }), registry });
await api.listen({ host: '0.0.0.0', port: config.PORT });
logger.info({ queue: Queues.bookingAgent.name, port: config.PORT }, 'booking_agent_started');

const shutdown = async () => {
  await api.close();
  await bus.close();
  await mcp.close();
  redis.disconnect();
  await tracing.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
