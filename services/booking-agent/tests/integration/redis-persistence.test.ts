// Integração (só no CI): repositório da conversa e fila de atendimento num Redis real.
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisConversationRepository, RedisHandoffQueue, RedisMediaNotes } from '../../src/adapters/persistence/redis.js';
import { ConcurrentModification } from '../../src/application/ports.js';
import { Conversation } from '../../src/domain/conversation.js';

let container: StartedRedisContainer;
let redis: Redis;

beforeAll(async () => {
  container = await new RedisContainer('redis:7.4.6-alpine').start();
  redis = new Redis(container.getConnectionUrl());
});

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
});

describe('Redis', () => {
  it('salva e restaura a conversa, recusando gravação com versão antiga', async () => {
    const repo = new RedisConversationRepository(redis);
    const conversation = Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
    conversation.receive('wamid.1');
    await repo.save(conversation);

    const a = await repo.load('estudio-lotus', '5511900000001');
    const b = await repo.load('estudio-lotus', '5511900000001');
    a!.receive('wamid.2');
    b!.receive('wamid.3');
    await repo.save(a!);

    await expect(repo.save(b!)).rejects.toBeInstanceOf(ConcurrentModification);
    expect((await repo.load('estudio-lotus', '5511900000001'))!.snapshot().processedMessageIds).toEqual(['wamid.1', 'wamid.2']);
  });

  it('anotação de mídia: prazo próprio por mensagem, que salvar outra não renova', async () => {
    const notes = new RedisMediaNotes(redis);
    const note = { kind: 'image' as const, status: 'processed' as const, rejectionReason: null, transcribed: false, thumbnailKey: null };
    await notes.save('estudio-lotus', 'wamid.R1', note);
    await redis.expire('wba:media-notes:estudio-lotus:wamid.R1', 100);

    await notes.save('estudio-lotus', 'wamid.R2', note);

    expect(await redis.ttl('wba:media-notes:estudio-lotus:wamid.R1')).toBeLessThanOrEqual(100);
    expect(await redis.ttl('wba:media-notes:estudio-lotus:wamid.R2')).toBeGreaterThan(29 * 24 * 60 * 60);
    expect([...(await notes.findMany('estudio-lotus', ['wamid.R1', 'wamid.R2'])).keys()]).toEqual(['wamid.R1', 'wamid.R2']);
    expect((await notes.findMany('estudio-sol', ['wamid.R1'])).size).toBe(0);
  });

  it('fila de atendimento por estúdio, em ordem de chegada e sem duplicar', async () => {
    const queue = new RedisHandoffQueue(redis);
    const ticket = (contactId: string, requestedAt: string) => ({
      tenantId: 'estudio-lotus',
      conversationId: `estudio-lotus:${contactId}`,
      contactId,
      reason: 'explicit_request' as const,
      requestedAt,
    });

    await queue.enqueue(ticket('5511900000002', '2026-03-02T12:05:00.000Z'));
    await queue.enqueue(ticket('5511900000001', '2026-03-02T12:00:00.000Z'));
    await queue.enqueue(ticket('5511900000001', '2026-03-02T12:09:00.000Z'));
    await queue.remove('estudio-lotus', 'estudio-lotus:5511900000002');

    const list = await queue.list('estudio-lotus');
    expect(list.map((t) => t.contactId)).toEqual(['5511900000001']);
    expect(await queue.list('outro-estudio')).toEqual([]);
  });
});
