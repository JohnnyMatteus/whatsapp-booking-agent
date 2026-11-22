// Retenção dos modelos de leitura do painel: prazo independente por conversa, isolamento por estúdio,
// migração do legado sem prazo e fila sem órfão. Redis falso com relógio; o real roda em tests/integration.
import { describe, expect, it } from 'vitest';
import { CONVERSATION_TTL_SECONDS, READ_MODEL_TTL_SECONDS, RedisConversationLog, RedisHandoffQueue } from '../../src/adapters/persistence/redis.js';
import type { HandoffTicket } from '../../src/application/ports.js';
import { Conversation } from '../../src/domain/conversation.js';
import { FakeRedis } from '../support/fake-redis.js';

const DAY_MS = 86_400_000;
const START = Date.parse('2026-03-02T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(START + offsetMs).toISOString();

const entry = (id: string, at: string, text: string) => ({ id, at, kind: 'student' as const, text, transcribed: false, messageId: `m-${id}`, action: null });
const conversation = (tenantId: string, contactId: string) => Conversation.start({ tenantId, contactId });
const ticket = (tenantId: string, contactId: string, requestedAt: string): HandoffTicket => ({
  tenantId,
  conversationId: `${tenantId}:${contactId}`,
  contactId,
  reason: 'explicit_request',
  requestedAt,
});

function logSetup() {
  const redis = new FakeRedis();
  redis.now = START;
  return { redis, log: new RedisConversationLog(redis.asRedis()) };
}

describe('resumos da fila do painel (RedisConversationLog)', () => {
  it('cada resumo expira no seu prazo: a atividade de uma conversa não renova a de outra', async () => {
    const { redis, log } = logSetup();
    await log.record(conversation('estudio-lotus', '5511900000001'), [entry('1', iso(0), 'quero reservar')]);
    redis.advance(10 * DAY_MS);
    await log.record(conversation('estudio-lotus', '5511900000002'), [entry('2', iso(10 * DAY_MS), 'oi')]);
    redis.advance(10 * DAY_MS);
    await log.record(conversation('estudio-lotus', '5511900000002'), [entry('3', iso(20 * DAY_MS), 'e então?')]);

    redis.advance(READ_MODEL_TTL_SECONDS * 1000 - 20 * DAY_MS + 1000);
    const left = await log.summaries('estudio-lotus', new Date(redis.now));

    expect(left.map((s) => s.contactId)).toEqual(['5511900000002']);
    expect(redis.has('wba:log:estudio-lotus:summaries', 'estudio-lotus:5511900000001')).toBe(false);
  });

  it('depois do prazo nada com telefone ou prévia de mensagem sobra: nem o resumo nem a linha do tempo', async () => {
    const { redis, log } = logSetup();
    await log.record(conversation('estudio-lotus', '5511900000001'), [entry('1', iso(0), 'estou com dor no joelho')]);

    redis.advance(READ_MODEL_TTL_SECONDS * 1000 + 1000);

    expect(await log.summaries('estudio-lotus', new Date(redis.now))).toEqual([]);
    expect(await log.timeline('estudio-lotus', 'estudio-lotus:5511900000001')).toEqual([]);
  });

  it('um estúdio não enxerga os resumos do outro', async () => {
    const { log } = logSetup();
    await log.record(conversation('estudio-lotus', '5511900000001'), [entry('1', iso(0), 'oi')]);
    await log.record(conversation('estudio-sol', '5511900000009'), [entry('2', iso(0), 'oi')]);

    expect((await log.summaries('estudio-lotus')).map((s) => s.contactId)).toEqual(['5511900000001']);
    expect((await log.summaries('estudio-sol')).map((s) => s.contactId)).toEqual(['5511900000009']);
  });

  it('o resumo expira antes da conversa: o item que a fila lista sempre tem detalhe', () => {
    expect(READ_MODEL_TTL_SECONDS).toBeLessThan(CONVERSATION_TTL_SECONDS);
    expect(CONVERSATION_TTL_SECONDS - READ_MODEL_TTL_SECONDS).toBeGreaterThanOrEqual(3600);
  });

  it('legado sem prazo: o recente ganha o prazo que teria tido e o vencido é apagado na primeira leitura', async () => {
    const { redis, log } = logSetup();
    const summary = (contactId: string, updatedAt: string) =>
      JSON.stringify({ conversationId: `estudio-lotus:${contactId}`, contactId, status: 'bot_active', handoff: null, lastMessage: { author: 'student', preview: 'oi', at: updatedAt }, updatedAt });
    const key = 'wba:log:estudio-lotus:summaries';
    await redis.hset(key, 'estudio-lotus:velho', summary('velho', iso(-40 * DAY_MS)));
    await redis.hset(key, 'estudio-lotus:recente', summary('recente', iso(-5 * DAY_MS)));

    const first = await log.summaries('estudio-lotus', new Date(START));

    expect(first.map((s) => s.contactId)).toEqual(['recente']);
    expect(redis.has(key, 'estudio-lotus:velho')).toBe(false);
    const [ttl] = await redis.httl(key, 'FIELDS', 1, 'estudio-lotus:recente');
    expect(ttl).toBe(READ_MODEL_TTL_SECONDS - 5 * 86_400);
    redis.advance((READ_MODEL_TTL_SECONDS - 5 * 86_400) * 1000 + 1000);
    expect(await log.summaries('estudio-lotus', new Date(redis.now))).toEqual([]);
  });
});

describe('fila de atendimento (RedisHandoffQueue)', () => {
  function queueSetup() {
    const redis = new FakeRedis();
    redis.now = START;
    return { redis, queue: new RedisHandoffQueue(redis.asRedis()) };
  }

  it('lista o mais antigo primeiro e cada ticket expira no seu prazo, sem renovar o dos outros', async () => {
    const { redis, queue } = queueSetup();
    await queue.enqueue(ticket('estudio-lotus', '5511900000002', iso(5 * 60_000)));
    await queue.enqueue(ticket('estudio-lotus', '5511900000001', iso(0)));
    redis.advance(10 * DAY_MS);
    await queue.enqueue(ticket('estudio-lotus', '5511900000003', iso(10 * DAY_MS)));

    expect((await queue.list('estudio-lotus', new Date(redis.now))).map((t) => t.contactId)).toEqual(['5511900000001', '5511900000002', '5511900000003']);

    redis.advance(READ_MODEL_TTL_SECONDS * 1000 - 10 * DAY_MS + 1000);
    expect((await queue.list('estudio-lotus', new Date(redis.now))).map((t) => t.contactId)).toEqual(['5511900000003']);
  });

  it('reenfileirar a mesma conversa mantém a posição e o prazo do primeiro pedido', async () => {
    const { redis, queue } = queueSetup();
    await queue.enqueue(ticket('estudio-lotus', '5511900000001', iso(0)));
    redis.advance(DAY_MS);
    await queue.enqueue(ticket('estudio-lotus', '5511900000001', iso(DAY_MS)));

    const [only] = await queue.list('estudio-lotus', new Date(redis.now));
    const [ttl] = await redis.httl('wba:handoffs:estudio-lotus:tickets', 'FIELDS', 1, 'estudio-lotus:5511900000001');

    expect(only?.requestedAt).toBe(iso(0));
    expect(ttl).toBe(READ_MODEL_TTL_SECONDS - 86_400);
  });

  it('isolamento por estúdio e remoção ao devolver ao bot', async () => {
    const { queue } = queueSetup();
    await queue.enqueue(ticket('estudio-lotus', '5511900000001', iso(0)));
    await queue.enqueue(ticket('estudio-sol', '5511900000009', iso(0)));

    await queue.remove('estudio-lotus', 'estudio-lotus:5511900000001');

    expect(await queue.list('estudio-lotus')).toEqual([]);
    expect((await queue.list('estudio-sol')).map((t) => t.contactId)).toEqual(['5511900000009']);
  });

  it('legado: apaga o sorted set sem prazo e dá prazo aos tickets antigos (ou os apaga se vencidos)', async () => {
    const { redis, queue } = queueSetup();
    const key = 'wba:handoffs:estudio-lotus:tickets';
    await redis.hset(key, 'estudio-lotus:velho', JSON.stringify(ticket('estudio-lotus', 'velho', iso(-45 * DAY_MS))));
    await redis.hset(key, 'estudio-lotus:recente', JSON.stringify(ticket('estudio-lotus', 'recente', iso(-2 * DAY_MS))));

    const listed = await queue.list('estudio-lotus', new Date(START));

    expect(listed.map((t) => t.contactId)).toEqual(['recente']);
    expect(redis.commands).toContain('del wba:handoffs:estudio-lotus:order');
    expect(redis.has(key, 'estudio-lotus:velho')).toBe(false);
    expect((await redis.httl(key, 'FIELDS', 1, 'estudio-lotus:recente'))[0]).toBe(READ_MODEL_TTL_SECONDS - 2 * 86_400);
  });
});
