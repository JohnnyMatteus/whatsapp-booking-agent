// Porta de entrada: webhook da WhatsApp Cloud API.
// Ordem por requisição: assinatura → tradução (ACL) → para cada item: reserva idempotente →
// publicação. Responde 200 só depois de publicar; em falha, 500 faz a Meta reentregar.
import { createEnvelope, type AnyEnvelope } from '@wba/contracts';
import type { Logger, Registry } from '@wba/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { MalformedWebhook, translateWebhook, type TenantDirectory } from '../acl/inbound/translate-webhook.js';
import type { Clock, EnvelopePublisher, IdempotencyStore } from '../ports.js';
import type { GatewayMetrics } from '../telemetry.js';
import { isValidSignature, isValidVerifyToken } from './signature.js';

export interface WebhookDeps {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly tenants: TenantDirectory;
  readonly idempotency: IdempotencyStore;
  readonly publisher: EnvelopePublisher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: GatewayMetrics;
  readonly registry: Registry;
  readonly isReady?: () => boolean;
}

const BODY_LIMIT_BYTES = 256 * 1024;

export function buildWebhookServer(deps: WebhookDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES, logger: false });
  const { metrics, logger } = deps;

  // Corpo bruto: a assinatura é calculada sobre os bytes exatos que a Meta enviou.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/webhook', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query['hub.mode'] === 'subscribe' && isValidVerifyToken(query['hub.verify_token'], deps.verifyToken)) {
      return reply.type('text/plain').send(query['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'verificação recusada' });
  });

  app.post('/webhook', async (request, reply) => {
    const raw = request.body;
    if (!Buffer.isBuffer(raw)) {
      metrics.webhookRequests.inc({ result: 'unsupported_media_type' });
      return reply.code(415).send({ error: 'esperado application/json' });
    }
    if (!isValidSignature(raw, request.headers['x-hub-signature-256'] as string | undefined, deps.appSecret)) {
      metrics.webhookRequests.inc({ result: 'invalid_signature' });
      logger.warn({ ip: request.ip }, 'webhook_invalid_signature');
      return reply.code(401).send({ error: 'assinatura inválida' });
    }

    let translation;
    try {
      translation = translateWebhook(JSON.parse(raw.toString('utf8')), deps.tenants);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof MalformedWebhook) {
        // Assinado mas fora do formato: 200 para a Meta não reenviar algo que nunca vai passar.
        metrics.webhookRequests.inc({ result: 'malformed' });
        logger.error({ err: error }, 'webhook_malformed');
        return reply.code(200).send({ status: 'ignored' });
      }
      throw error;
    }

    for (const item of translation.ignored) {
      metrics.webhookItems.inc({ type: 'ignored', outcome: item.reason });
      logger.info({ reason: item.reason, detail: item.reason === 'unknown_tenant' ? item.detail : undefined }, 'webhook_item_ignored');
    }

    for (const item of translation.translated) {
      if (!(await deps.idempotency.claim(item.dedupKey))) {
        metrics.webhookItems.inc({ type: item.command.type, outcome: 'duplicate' });
        logger.info({ correlationId: item.correlationId, type: item.command.type }, 'webhook_item_duplicate');
        continue;
      }
      const envelope = createEnvelope(item.command.type, item.command.payload, {
        id: randomUUID(),
        correlationId: item.correlationId,
        occurredAt: deps.clock.now(),
      }) as AnyEnvelope;
      try {
        await deps.publisher.publish(envelope);
      } catch (error) {
        await deps.idempotency.release(item.dedupKey);
        metrics.webhookRequests.inc({ result: 'publish_failed' });
        logger.error({ err: error, correlationId: item.correlationId }, 'webhook_publish_failed');
        return reply.code(500).send({ error: 'falha ao enfileirar; a Meta vai reenviar' });
      }
      metrics.webhookItems.inc({ type: item.command.type, outcome: 'published' });
      logger.info({ correlationId: item.correlationId, type: item.command.type, envelopeId: envelope.id }, 'webhook_item_published');
    }

    metrics.webhookRequests.inc({ result: 'accepted' });
    return reply.code(200).send({ status: 'ok' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) =>
    (deps.isReady?.() ?? true) ? { status: 'ready' } : reply.code(503).send({ status: 'not_ready' }),
  );
  app.get('/metrics', async (_request, reply) => reply.type(deps.registry.contentType).send(await deps.registry.metrics()));

  return app;
}
