import { PermanentFailure } from '@wba/messaging';
import { describe, expect, it } from 'vitest';
import { InMemoryMediaCache } from '../../src/adapters/redis-media-cache.js';
import { classifyWhatsmiauStatus, HttpWhatsmiauClient, WhatsmiauTransientError, type WhatsmiauClient } from '../../src/providers/whatsmiau/client.js';
import { WhatsmiauProvider, WEBHOOK_SECRET_HEADER } from '../../src/providers/whatsmiau/provider.js';
import { channels } from '../support/providers.js';
import { readFileSync } from 'node:fs';

const SECRET = 'dev-only-whatsmiau-webhook-secret';
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/inbound/${name}.json`, import.meta.url), 'utf8'));

class FakeClient implements WhatsmiauClient {
  sent: { instance: string; path: string }[] = [];
  downloads: string[] = [];
  async send(instance: string, message: { path: string }) {
    this.sent.push({ instance, path: message.path });
    return { messageId: '3EB0OUT' };
  }
  async download(url: string) {
    this.downloads.push(url);
    return { data: Buffer.from('JPEG'), mimeType: 'image/jpeg' };
  }
}

function make(client = new FakeClient(), mediaHosts = ['midia.exemplo.test']) {
  const mediaCache = new InMemoryMediaCache();
  const provider = new WhatsmiauProvider({ webhookSecret: SECRET, client, directory: channels.forProvider('whatsmiau'), mediaCache, mediaHosts });
  return { provider, client, mediaCache };
}

describe('WhatsmiauProvider', () => {
  it('autentica o webhook pelo segredo no cabeçalho configurado na instância', () => {
    const { provider } = make();
    const request = (secret?: string) => ({ rawBody: Buffer.from('{}'), headers: secret === undefined ? {} : { [WEBHOOK_SECRET_HEADER]: secret } });

    expect(provider.verifyWebhook(request(SECRET))).toBe(true);
    expect(provider.verifyWebhook(request('outro-segredo-qualquer-x'))).toBe(false);
    expect(provider.verifyWebhook(request())).toBe(false);
  });

  it('envia pela instância do estúdio', async () => {
    const { provider, client } = make();

    const result = await provider.send({ tenantId: 'estudio-sol', contactId: '5511900000001', content: { kind: 'text', text: 'oi' } });

    expect(result).toEqual({ messageId: '3EB0OUT' });
    expect(client.sent).toEqual([{ instance: 'sol', path: 'sendText' }]);
  });

  it('estúdio sem instância é falha permanente', async () => {
    const { provider } = make();

    await expect(provider.send({ tenantId: 'estudio-lotus', contactId: '1', content: { kind: 'text', text: 'oi' } })).rejects.toBeInstanceOf(PermanentFailure);
  });

  it('mídia em base64 do webhook é servida sem nova chamada ao Whatsmiau', async () => {
    const { provider, client } = make();
    await provider.parseWebhook({ ...(fixture('audio-base64') as object), instance: 'sol' });

    const media = await provider.fetchMedia('estudio-sol', '3EB0A0000000000000000002');

    expect(media.data.toString()).toBe('Ogg' + 'S-fake-audio');
    expect(media.mimeType).toBe('audio/ogg; codecs=opus');
    expect(client.downloads).toEqual([]);
  });

  it('mídia por URL só é baixada de hosts permitidos', async () => {
    const allowed = make();
    await allowed.provider.parseWebhook({ ...(fixture('image-media-url') as object), instance: 'sol' });
    await expect(allowed.provider.fetchMedia('estudio-sol', '3EB0A0000000000000000003')).resolves.toMatchObject({ mimeType: 'image/jpeg' });

    const denied = make(new FakeClient(), ['outro-host.test']);
    await denied.provider.parseWebhook({ ...(fixture('image-media-url') as object), instance: 'sol' });
    await expect(denied.provider.fetchMedia('estudio-sol', '3EB0A0000000000000000003')).rejects.toThrow(/host de mídia não permitido/);
    expect(denied.client.downloads).toEqual([]);
  });

  it('mídia desconhecida ou expirada é falha permanente', async () => {
    await expect(make().provider.fetchMedia('estudio-sol', 'nao-existe')).rejects.toBeInstanceOf(PermanentFailure);
  });
});

describe('cliente HTTP do Whatsmiau', () => {
  const options = { baseUrl: 'http://miau.local/', apiKey: 'dev-only-apikey', timeoutMs: 1000 };
  const text = { path: 'sendText', body: { number: '5511900000001', text: 'oi' } } as const;

  it('chama /v1/message/sendText/{instance} com o cabeçalho apikey e lê key.id', async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
    const client = new HttpWhatsmiauClient(options, async (url, init) => {
      seen = { url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) };
      return new Response(JSON.stringify({ key: { id: '3EB0OUT' }, status: 'PENDING' }), { status: 201 });
    });

    await expect(client.send('sol', text)).resolves.toEqual({ messageId: '3EB0OUT' });
    expect(seen?.url).toBe('http://miau.local/v1/message/sendText/sol');
    expect(seen?.headers).toMatchObject({ apikey: 'dev-only-apikey' });
    expect(JSON.parse(seen?.body ?? '{}')).toEqual({ number: '5511900000001', text: 'oi' });
  });

  it.each([
    [429, 'transient'],
    [503, 'transient'],
    [400, 'permanent'],
    [401, 'permanent'],
  ] as const)('status %i → %s', (status, expectedClass) => {
    expect(classifyWhatsmiauStatus(status)).toBe(expectedClass);
  });

  it('o corpo de erro (que pode ecoar o texto do aluno) não entra na exceção', async () => {
    const client = new HttpWhatsmiauClient(options, async () => new Response('texto do aluno ecoado', { status: 400 }));

    await expect(client.send('sol', text)).rejects.toThrow(/^Whatsmiau respondeu 400$/);
  });

  it('falha de rede é transitória', async () => {
    const client = new HttpWhatsmiauClient(options, async () => {
      throw new TypeError('fetch failed');
    });

    await expect(client.send('sol', text)).rejects.toBeInstanceOf(WhatsmiauTransientError);
  });
});
