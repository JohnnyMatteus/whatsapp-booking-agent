// media.processed → anotação por mensagem → linha do tempo e miniatura no painel, pelo consumidor e pela API.
import { createEnvelope, MessageType } from '@wba/contracts';
import { createLogger } from '@wba/observability';
import { describe, expect, it, vi } from 'vitest';
import { HttpThumbnailSource, MediaProcessorUnavailable } from '../../src/adapters/media/http-thumbnails.js';
import { createInboundHandler } from '../../src/adapters/messaging/consumer.js';
import { InMemoryContactLock, InMemoryMediaNotes } from '../../src/adapters/persistence/in-memory.js';
import { CONVERSATION, setup, TENANT, THUMBNAIL_KEY } from '../support/panel-harness.js';
import { NOW } from '../domain/fixtures.js';

const origin = { tenantId: TENANT, contactId: '5511900000001', messageId: 'wamid.1', receivedAt: NOW.toISOString() };
const processed = (extra: object) =>
  createEnvelope(MessageType.MediaProcessed, { ...origin, kind: 'image', status: 'processed', mimeType: 'image/jpeg', transcribed: false, ...extra }, { id: 'e1', correlationId: 'wamid.1', occurredAt: NOW });

describe('consumidor de media.processed', () => {
  it('guarda a anotação da mensagem sem acionar o agente', async () => {
    const mediaNotes = new InMemoryMediaNotes();
    const useCase = { execute: vi.fn() };
    const handle = createInboundHandler({ useCase: useCase as never, metrics: {} as never, recorder: {} as never, mediaNotes, locks: new InMemoryContactLock(), logger: createLogger('test'), tracer: {} as never });

    await handle(processed({ thumbnailKey: THUMBNAIL_KEY }));
    await handle(processed({ messageId: 'wamid.2', status: 'rejected', rejectionReason: 'too_large' } as object));

    expect(await mediaNotes.find(TENANT, 'wamid.1')).toEqual({ kind: 'image', status: 'processed', rejectionReason: null, transcribed: false, thumbnailKey: THUMBNAIL_KEY });
    expect(useCase.execute).not.toHaveBeenCalled();
  });
});

describe('API do painel com mídia', () => {
  it('a conversa traz a mídia da mensagem do aluno sem expor a chave do armazenamento', async () => {
    const { app, auth } = await setup({ handedOff: true });

    const body = (await app.inject({ url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}`, headers: auth })).json();

    expect(body.timeline[0].media).toEqual({ kind: 'image', status: 'processed', rejectionReason: null, hasThumbnail: true });
    expect(JSON.stringify(body)).not.toContain(THUMBNAIL_KEY);
  });

  it('serve a miniatura como imagem, com cache privado', async () => {
    const { app, auth, thumbnailBytes } = await setup({ handedOff: true });

    const response = await app.inject({ url: `/api/tenants/${TENANT}/media/wamid.1/thumbnail`, headers: auth });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('private, max-age=300');
    expect(new Uint8Array(response.rawPayload)).toEqual(thumbnailBytes);
  });

  it('404 sem miniatura, mensagem desconhecida ou chave de outro estúdio na anotação', async () => {
    const { app, auth, mediaNotes } = await setup({ handedOff: true });
    await mediaNotes.save(TENANT, 'wamid.rejeitada', { kind: 'image', status: 'rejected', rejectionReason: 'corrupt', transcribed: false, thumbnailKey: null });
    await mediaNotes.save(TENANT, 'wamid.alheia', { kind: 'image', status: 'processed', rejectionReason: null, transcribed: false, thumbnailKey: 'media/estudio-sol/2026-03-02/x.thumb.jpg' });

    for (const id of ['wamid.rejeitada', 'wamid.nao-existe', 'wamid.alheia']) {
      expect((await app.inject({ url: `/api/tenants/${TENANT}/media/${id}/thumbnail`, headers: auth })).statusCode).toBe(404);
    }
  });
});

describe('HttpThumbnailSource', () => {
  const source = (response: Response) => new HttpThumbnailSource('http://media:8083', 'dev-only-media-token', vi.fn().mockResolvedValue(response));

  it('devolve os bytes, null no 404 e erro sem corpo nos demais', async () => {
    expect(await source(new Response(new Uint8Array([1, 2]))).fetch('k')).toEqual(new Uint8Array([1, 2]));
    expect(await source(new Response('x', { status: 404 })).fetch('k')).toBeNull();
    await expect(source(new Response('corpo secreto', { status: 500 })).fetch('k')).rejects.toThrow(MediaProcessorUnavailable);
  });

  it('envia a chave como parâmetro e o token de serviço', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));

    await new HttpThumbnailSource('http://media:8083', 'tok', fetchImpl).fetch('media/a b/c.thumb.jpg');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://media:8083/internal/thumbnails?key=media%2Fa+b%2Fc.thumb.jpg');
    expect(init.headers['x-internal-token']).toBe('tok');
  });
});
