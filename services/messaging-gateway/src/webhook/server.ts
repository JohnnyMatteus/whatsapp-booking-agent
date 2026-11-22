// Porta de entrada HTTP dos provedores: /webhooks/:provider (público, sem JWT; cada provedor
// autentica o seu) e /internal/media (só rede interna, token de serviço).
// Ordem por webhook: autenticidade → tradução (ACL do provedor) → por item: reserva idempotente →
// publicação. Responde 200 só depois de publicar; em falha, 500 faz o provedor reentregar.
import { createEnvelope, type AnyEnvelope } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import type { Logger, Registry } from '@wba/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { MalformedWebhook } from '../domain/inbound.js';
import type { Clock, EnvelopePublisher, IdempotencyStore } from '../ports.js';
import type { ProviderRegistry } from '../registry.js';
import type { GatewayMetrics } from '../telemetry.js';

export interface WebhookDeps {
  readonly providers: ProviderRegistry;
  readonly idempotency: IdempotencyStore;
  readonly publisher: EnvelopePublisher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: GatewayMetrics;
  readonly registry: Registry;
  readonly internalToken: string;
  readonly isReady?: () => boolean;
}

/** Cloud API manda lotes pequenos; o Whatsmiau pode embutir a mídia em base64 no corpo. */
const BODY_LIMIT_BYTES: Record<string, number> = { 'cloud-api': 256 * 1024, whatsmiau: 20 * 1024 * 1024 };
const DEFAULT_BODY_LIMIT = 256 * 1024;

export function buildWebhookServer(deps: WebhookDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: Math.max(...Object.values(BODY_LIMIT_BYTES)), logger: false });
  const { metrics, logger } = deps;

  // Corpo bruto: assinaturas são calculadas sobre os bytes exatos que o provedor enviou.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/webhooks/:provider', async (request, reply) => {
    const provider = deps.providers.byId((request.params as { provider: string }).provider);
    const challenge = provider?.verifySubscription?.(request.query as Record<string, string | undefined>) ?? null;
    if (challenge === null) return reply.code(403).send({ error: 'verificação recusada' });
    return reply.type('text/plain').send(challenge);
  });

  app.post('/webhooks/:provider', async (request, reply) => {
    const name = (request.params as { provider: string }).provider;
    const provider = deps.providers.byId(name);
    if (provider === null) return reply.code(404).send({ error: 'provedor desconhecido' });
    const raw = request.body;
    if (!Buffer.isBuffer(raw)) {
      metrics.webhookRequests.inc({ provider: name, result: 'unsupported_media_type' });
      return reply.code(415).send({ error: 'esperado application/json' });
    }
    if (raw.length > (BODY_LIMIT_BYTES[name] ?? DEFAULT_BODY_LIMIT)) {
      metrics.webhookRequests.inc({ provider: name, result: 'too_large' });
      return reply.code(413).send({ error: 'corpo acima do limite do provedor' });
    }
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    if (!provider.verifyWebhook({ rawBody: raw, headers })) {
      metrics.webhookRequests.inc({ provider: name, result: 'invalid_signature' });
      logger.warn({ provider: name, ip: request.ip }, 'webhook_invalid_signature');
      return reply.code(401).send({ error: 'assinatura inválida' });
    }

    let translation;
    try {
      translation = await provider.parseWebhook(JSON.parse(raw.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof MalformedWebhook) {
        // Autêntico mas fora do formato: 200 para o provedor não reenviar algo que nunca vai passar.
        metrics.webhookRequests.inc({ provider: name, result: 'malformed' });
        logger.error({ provider: name, err: error }, 'webhook_malformed');
        return reply.code(200).send({ status: 'ignored' });
      }
      throw error;
    }

    for (const item of translation.ignored) {
      metrics.webhookItems.inc({ provider: name, type: 'ignored', outcome: item.reason });
      logger.info({ provider: name, reason: item.reason, detail: item.reason === 'unknown_tenant' ? item.detail : undefined }, 'webhook_item_ignored');
    }

    for (const item of translation.translated) {
      const dedupKey = `${name}:${item.dedupKey}`;
      if (!(await deps.idempotency.claim(dedupKey))) {
        metrics.webhookItems.inc({ provider: name, type: item.command.type, outcome: 'duplicate' });
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
        await deps.idempotency.release(dedupKey);
        metrics.webhookRequests.inc({ provider: name, result: 'publish_failed' });
        logger.error({ err: error, correlationId: item.correlationId }, 'webhook_publish_failed');
        return reply.code(500).send({ error: 'falha ao enfileirar; o provedor vai reenviar' });
      }
      metrics.webhookItems.inc({ provider: name, type: item.command.type, outcome: 'published' });
      logger.info({ correlationId: item.correlationId, type: item.command.type, envelopeId: envelope.id }, 'webhook_item_published');
    }

    metrics.webhookRequests.inc({ provider: name, result: 'accepted' });
    return reply.code(200).send({ status: 'ok' });
  });

  // API interna de mídia: o media-processor pede os bytes sem saber qual provedor o estúdio usa.
  app.get('/internal/media/:tenantId/:mediaId', async (request, reply) => {
    const token = Buffer.from(String(request.headers['x-internal-token'] ?? ''));
    const expected = Buffer.from(deps.internalToken);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) return reply.code(401).send({ error: 'não autorizado' });
    const { tenantId, mediaId } = request.params as { tenantId: string; mediaId: string };
    const provider = deps.providers.forTenant(tenantId);
    if (provider === null) return reply.code(404).send({ error: 'estúdio sem canal configurado' });
    try {
      const media = await provider.fetchMedia(tenantId, mediaId);
      return reply.type(media.mimeType).send(media.data);
    } catch (error) {
      // 404 e 410 do provedor não melhoram com retry; o resto sim (502).
      logger.warn({ provider: provider.id, err: error }, 'media_fetch_failed');
      return reply.code(error instanceof PermanentFailure ? 404 : 502).send({ error: 'mídia indisponível' });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) =>
    (deps.isReady?.() ?? true) ? { status: 'ready' } : reply.code(503).send({ status: 'not_ready' }),
  );
  app.get('/metrics', async (_request, reply) => reply.type(deps.registry.contentType).send(await deps.registry.metrics()));

  return app;
}
