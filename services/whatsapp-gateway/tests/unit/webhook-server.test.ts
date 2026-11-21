import { MessageType, type AnyEnvelope } from '@wba/contracts';
import { createLogger, createMetricsRegistry } from '@wba/observability';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryIdempotencyStore } from '../../src/adapters/redis-idempotency.js';
import { StaticTenantDirectory } from '../../src/adapters/tenant-directory.js';
import { createGatewayMetrics } from '../../src/telemetry.js';
import { buildWebhookServer } from '../../src/webhook/server.js';
import { signBody } from '../../src/webhook/signature.js';

const SECRET = 'dev-only-change-me-app-secret';
const fixture = (name: string) => readFileSync(new URL(`../contract/fixtures/inbound/${name}.json`, import.meta.url));

class FakePublisher {
  published: AnyEnvelope[] = [];
  failures = 0;
  async publish(envelope: AnyEnvelope): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('broker indisponível');
    }
    this.published.push(envelope);
  }
}

function setup() {
  const publisher = new FakePublisher();
  const registry = createMetricsRegistry('test');
  const app = buildWebhookServer({
    appSecret: SECRET,
    verifyToken: 'dev-only-verify-token',
    tenants: new StaticTenantDirectory(new Map([['100000000000001', 'estudio-lotus']])),
    idempotency: new InMemoryIdempotencyStore(),
    publisher,
    clock: { now: () => new Date('2026-03-02T12:00:01Z') },
    logger: createLogger('test', 'silent'),
    metrics: createGatewayMetrics(registry),
    registry,
  });
  const post = (body: Buffer, signature = signBody(body, SECRET)) =>
    app.inject({ method: 'POST', url: '/webhook', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature } });
  return { app, publisher, post, registry };
}

describe('webhook da Cloud API', () => {
  it('responde o desafio de verificação só com o token certo', async () => {
    const { app } = setup();

    const ok = await app.inject({ url: '/webhook?hub.mode=subscribe&hub.verify_token=dev-only-verify-token&hub.challenge=1158201444' });
    const denied = await app.inject({ url: '/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1' });

    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1158201444');
    expect(denied.statusCode).toBe(403);
  });

  it('recusa assinatura inválida sem publicar nada', async () => {
    const { post, publisher } = setup();

    const response = await post(fixture('text-message'), 'sha256=' + '0'.repeat(64));

    expect(response.statusCode).toBe(401);
    expect(publisher.published).toEqual([]);
  });

  it('publica o comando traduzido com o id da mensagem como correlação', async () => {
    const { post, publisher } = setup();

    const response = await post(fixture('text-message'));

    expect(response.statusCode).toBe(200);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toMatchObject({
      type: MessageType.MessageReceived,
      version: 1,
      correlationId: 'wamid.HBgNNTUxMTkwMDAwMDAwMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==',
      occurredAt: '2026-03-02T12:00:01.000Z',
    });
  });

  it('é idempotente pelo id da mensagem: a reentrega da Meta não publica de novo', async () => {
    const { post, publisher, registry } = setup();

    await post(fixture('text-message'));
    const retry = await post(fixture('text-message'));

    expect(retry.statusCode).toBe(200);
    expect(publisher.published).toHaveLength(1);
    expect(await registry.metrics()).toMatch(/wba_webhook_items_total\{type="inbound.message_received",outcome="duplicate",service="test"\} 1/);
  });

  it('se publicar falhar, libera a chave e responde 500 para a Meta reenviar', async () => {
    const { post, publisher } = setup();
    publisher.failures = 1;

    const failed = await post(fixture('text-message'));
    const redelivered = await post(fixture('text-message'));

    expect(failed.statusCode).toBe(500);
    expect(redelivered.statusCode).toBe(200);
    expect(publisher.published).toHaveLength(1);
  });

  it('assinado mas fora do formato responde 200 e não publica (reenvio não adiantaria)', async () => {
    const { post, publisher } = setup();

    const response = await post(Buffer.from('{"object":"page","entry":[]}'));

    expect(response.statusCode).toBe(200);
    expect(publisher.published).toEqual([]);
  });

  it('status de entrega usam id + status como chave (delivered e read são eventos distintos)', async () => {
    const { post, publisher } = setup();

    await post(fixture('statuses'));
    await post(fixture('statuses'));

    expect(publisher.published.map((e) => e.type)).toEqual([MessageType.DeliveryStatusChanged, MessageType.DeliveryStatusChanged]);
  });
});
