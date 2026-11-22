// O gateway roteia webhook e envio por estúdio, sem o chamador saber qual provedor atende.
import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { createLogger, createMetricsRegistry } from '@wba/observability';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryIdempotencyStore } from '../../src/adapters/redis-idempotency.js';
import { InMemoryMediaCache } from '../../src/adapters/redis-media-cache.js';
import { WhatsmiauProvider } from '../../src/providers/whatsmiau/provider.js';
import { ReplySender } from '../../src/sender/reply-sender.js';
import { createGatewayMetrics } from '../../src/telemetry.js';
import { buildWebhookServer } from '../../src/webhook/server.js';
import { channels, cloudApiRegistry, FakeCloudApiClient } from '../support/providers.js';
import { createEnvelope } from '@wba/contracts';

const SECRET = 'dev-only-whatsmiau-webhook-secret';
const TOKEN = 'dev-only-internal-token';
const fixture = (name: string) => readFileSync(new URL(`../whatsmiau/fixtures/inbound/${name}.json`, import.meta.url));

function setup() {
  const published: AnyEnvelope[] = [];
  const miauSent: { instance: string; path: string }[] = [];
  const mediaCache = new InMemoryMediaCache();
  const whatsmiau = new WhatsmiauProvider({
    webhookSecret: SECRET,
    directory: channels.forProvider('whatsmiau'),
    mediaCache,
    mediaHosts: [],
    client: {
      async send(instance, message) {
        miauSent.push({ instance, path: message.path });
        return { messageId: '3EB0OUT' };
      },
      async download() {
        throw new Error('não deveria baixar');
      },
    },
  });
  const cloud = new FakeCloudApiClient();
  const providers = cloudApiRegistry(cloud, [whatsmiau]);
  const registry = createMetricsRegistry('test');
  const metrics = createGatewayMetrics(registry);
  const app = buildWebhookServer({
    providers,
    internalToken: TOKEN,
    idempotency: new InMemoryIdempotencyStore(),
    publisher: { publish: async (e) => void published.push(e) },
    clock: { now: () => new Date('2026-03-02T12:00:01Z') },
    logger: createLogger('test', 'silent'),
    metrics,
    registry,
  });
  const sender = new ReplySender({ providers, logger: createLogger('test', 'silent'), metrics });
  return { app, published, miauSent, cloud, sender };
}

// O estúdio do Whatsmiau no diretório de teste usa a instância "sol"; a fixture usa "estudio-sol".
const asInstance = (body: Buffer, instance: string) => Buffer.from(JSON.stringify({ ...JSON.parse(body.toString()), instance }));
const post = (app: ReturnType<typeof setup>['app'], body: Buffer, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/webhooks/whatsmiau', payload: body, headers: { 'content-type': 'application/json', ...headers } });

describe('webhook do Whatsmiau', () => {
  it('recusa sem o segredo, não publica e conta como assinatura inválida', async () => {
    const { app, published } = setup();

    const response = await post(app, asInstance(fixture('text-message'), 'sol'));

    expect(response.statusCode).toBe(401);
    expect(published).toEqual([]);
  });

  it('publica a mesma linguagem que a Cloud API e é idempotente', async () => {
    const { app, published } = setup();
    const body = asInstance(fixture('text-message'), 'sol');

    const first = await post(app, body, { 'x-webhook-secret': SECRET });
    const second = await post(app, body, { 'x-webhook-secret': SECRET });

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: MessageType.MessageReceived,
      correlationId: '3EB0A0000000000000000001',
      payload: { tenantId: 'estudio-sol', contactId: '5511900000001' },
    });
  });

  it('provedor desconhecido é 404 e o handshake GET só existe onde o provedor o exige', async () => {
    const { app } = setup();

    expect((await app.inject({ method: 'POST', url: '/webhooks/outro', payload: '{}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/webhooks/whatsmiau?hub.mode=subscribe' })).statusCode).toBe(403);
  });
});

describe('envio roteado por estúdio', () => {
  const reply = (tenantId: string) =>
    createEnvelope(
      MessageType.ReplyRequested,
      { tenantId, contactId: '5511900000001', content: { kind: 'text', text: 'Olá!' } },
      { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000003', correlationId: 'x', occurredAt: new Date('2026-03-02T12:00:00Z') },
    );

  it('a mesma resposta sai pela Cloud API para um estúdio e pelo Whatsmiau para outro', async () => {
    const { sender, cloud, miauSent } = setup();

    await sender.handle(reply('estudio-lotus'));
    await sender.handle(reply('estudio-sol'));

    expect(cloud.sent).toHaveLength(1);
    expect(miauSent).toEqual([{ instance: 'sol', path: 'sendText' }]);
  });
});

describe('API interna de mídia', () => {
  it('exige o token de serviço e devolve os bytes pelo provedor do estúdio', async () => {
    const { app } = setup();

    const denied = await app.inject({ url: '/internal/media/estudio-lotus/900000000000001' });
    const ok = await app.inject({ url: '/internal/media/estudio-lotus/900000000000001', headers: { 'x-internal-token': TOKEN } });
    const unknown = await app.inject({ url: '/internal/media/estudio-x/1', headers: { 'x-internal-token': TOKEN } });

    expect(denied.statusCode).toBe(401);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('audio/ogg');
    expect(ok.rawPayload.toString()).toBe('OggS-fake');
    expect(unknown.statusCode).toBe(404);
  });
});
