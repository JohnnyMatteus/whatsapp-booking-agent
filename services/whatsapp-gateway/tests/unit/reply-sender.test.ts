import { createEnvelope, MessageType } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import { createLogger, createMetricsRegistry } from '@wba/observability';
import { describe, expect, it } from 'vitest';
import type { MetaOutboundMessage } from '../../src/acl/cloud-api-types.js';
import { classifyCloudApiError, CloudApiTransientError, HttpCloudApiClient } from '../../src/adapters/cloud-api-http.js';
import { StaticTenantDirectory } from '../../src/adapters/tenant-directory.js';
import { ReplySender } from '../../src/sender/reply-sender.js';
import { createGatewayMetrics } from '../../src/telemetry.js';

const meta = { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000002', correlationId: 'wamid.X', occurredAt: new Date('2026-03-02T12:00:00Z') };
const reply = (tenantId = 'estudio-lotus') =>
  createEnvelope(MessageType.ReplyRequested, { tenantId, contactId: '5511900000001', content: { kind: 'text', text: 'Olá!' } }, meta);

function sender(send: (phone: string, message: MetaOutboundMessage) => Promise<{ messageId: string }>) {
  return new ReplySender({
    cloudApi: { send },
    tenants: new StaticTenantDirectory(new Map([['100000000000001', 'estudio-lotus']])),
    logger: createLogger('test', 'silent'),
    metrics: createGatewayMetrics(createMetricsRegistry('test')),
  });
}

describe('sender', () => {
  it('envia pelo número do estúdio com o corpo traduzido pela ACL', async () => {
    const calls: [string, MetaOutboundMessage][] = [];

    await sender(async (phone, message) => {
      calls.push([phone, message]);
      return { messageId: 'wamid.OUT' };
    }).handle(reply());

    expect(calls).toEqual([['100000000000001', expect.objectContaining({ type: 'text', to: '5511900000001' })]]);
  });

  it('estúdio sem número configurado é falha permanente (vai para a DLQ)', async () => {
    await expect(sender(async () => ({ messageId: 'x' })).handle(reply('estudio-desconhecido'))).rejects.toBeInstanceOf(PermanentFailure);
  });
});

describe('erros da Cloud API', () => {
  it.each([
    [429, 130429, 'transient'],
    [400, 131056, 'transient'],
    [503, null, 'transient'],
    [400, 131047, 'permanent'],
    [400, 100, 'permanent'],
    [401, 190, 'permanent'],
  ] as const)('status %i, código %s → %s', (status, code, expected) => {
    expect(classifyCloudApiError(status, code)).toBe(expected);
  });

  it('o cliente HTTP não coloca o corpo de erro (que pode ecoar a mensagem) na exceção', async () => {
    const client = new HttpCloudApiClient(
      { baseUrl: 'http://wiremock.local', apiVersion: 'v23.0', accessToken: 'dev-only-token', timeoutMs: 1000 },
      async () => new Response(JSON.stringify({ error: { code: 131047, message: 'texto do aluno ecoado aqui' } }), { status: 400 }),
    );

    await expect(client.send('100000000000001', { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511900000001', type: 'text', text: { body: 'oi', preview_url: false } }))
      .rejects.toThrow(/^Cloud API respondeu 400 \(código 131047\)$/);
  });

  it('falha de rede vira erro transitório', async () => {
    const client = new HttpCloudApiClient(
      { baseUrl: 'http://wiremock.local', apiVersion: 'v23.0', accessToken: 'dev-only-token', timeoutMs: 1000 },
      async () => {
        throw new TypeError('fetch failed');
      },
    );

    await expect(client.send('1', { messaging_product: 'whatsapp', recipient_type: 'individual', to: '1', type: 'text', text: { body: 'oi', preview_url: false } }))
      .rejects.toBeInstanceOf(CloudApiTransientError);
  });
});
