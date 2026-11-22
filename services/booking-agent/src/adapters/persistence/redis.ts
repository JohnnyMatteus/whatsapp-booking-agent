// Persistência da conversa e da fila de atendimento no Redis.
import type { Redis } from 'ioredis';
import {
  ConcurrentModification,
  type ConversationLog,
  type ConversationRepository,
  type ConversationSummary,
  type HandoffQueue,
  type HandoffTicket,
  type MediaNote,
  type MediaNotes,
  type MetricIncrement,
  type MetricsStore,
  type NoticeLedger,
  type TimelineEntry,
} from '../../application/ports.js';
import { Conversation, type ConversationSnapshot } from '../../domain/conversation.js';
import { TIMELINE_LIMIT, summarize } from './summary.js';

/** Conversa parada há 30 dias some; a transferida também (o atendimento já terá acontecido). */
const CONVERSATION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Compare-and-set atômico: só grava se a versão salva for a esperada.
const SAVE_IF_VERSION = `
local current = redis.call('GET', KEYS[1])
local version = 0
if current then version = tonumber(cjson.decode(current)['version']) end
if version ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

export class RedisConversationRepository implements ConversationRepository {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:conversation:',
  ) {}

  async load(tenantId: string, contactId: string): Promise<Conversation | null> {
    const raw = await this.redis.get(`${this.prefix}${tenantId}:${contactId}`);
    return raw ? Conversation.restore(JSON.parse(raw) as ConversationSnapshot) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    const snapshot = conversation.snapshot();
    const next = JSON.stringify({ ...snapshot, version: snapshot.version + 1 });
    const saved = await this.redis.eval(SAVE_IF_VERSION, 1, this.prefix + snapshot.id, snapshot.version, next, CONVERSATION_TTL_SECONDS);
    if (saved !== 1) throw new ConcurrentModification(snapshot.id);
  }
}

/** Fila por estúdio: hash com os tickets e sorted set pela hora do pedido (mais antigo primeiro). */
export class RedisHandoffQueue implements HandoffQueue {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:handoffs:',
  ) {}

  async enqueue(ticket: HandoffTicket): Promise<void> {
    await this.redis
      .multi()
      .hset(`${this.prefix}${ticket.tenantId}:tickets`, ticket.conversationId, JSON.stringify(ticket))
      .zadd(`${this.prefix}${ticket.tenantId}:order`, 'NX', Date.parse(ticket.requestedAt), ticket.conversationId)
      .exec();
  }

  async list(tenantId: string): Promise<readonly HandoffTicket[]> {
    const ids = await this.redis.zrange(`${this.prefix}${tenantId}:order`, 0, -1);
    if (ids.length === 0) return [];
    const raw = await this.redis.hmget(`${this.prefix}${tenantId}:tickets`, ...ids);
    return raw.flatMap((item) => (item ? [JSON.parse(item) as HandoffTicket] : []));
  }

  async remove(tenantId: string, conversationId: string): Promise<void> {
    await this.redis
      .multi()
      .hdel(`${this.prefix}${tenantId}:tickets`, conversationId)
      .zrem(`${this.prefix}${tenantId}:order`, conversationId)
      .exec();
  }
}

/** Linha do tempo (lista limitada) e resumo por conversa, num hash por estúdio. */
export class RedisConversationLog implements ConversationLog {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:log:',
  ) {}

  async record(conversation: Conversation, entries: readonly TimelineEntry[]): Promise<void> {
    const timelineKey = `${this.prefix}${conversation.tenantId}:timeline:${conversation.id}`;
    const pipeline = this.redis.multi();
    if (entries.length > 0) {
      pipeline.rpush(timelineKey, ...entries.map((e) => JSON.stringify(e))).ltrim(timelineKey, -TIMELINE_LIMIT, -1).expire(timelineKey, CONVERSATION_TTL_SECONDS);
    }
    await pipeline.exec();
    const timeline = await this.timeline(conversation.tenantId, conversation.id);
    await this.redis.hset(`${this.prefix}${conversation.tenantId}:summaries`, conversation.id, JSON.stringify(summarize(conversation, timeline)));
  }

  async summaries(tenantId: string): Promise<readonly ConversationSummary[]> {
    const raw = await this.redis.hvals(`${this.prefix}${tenantId}:summaries`);
    return raw.map((item) => JSON.parse(item) as ConversationSummary);
  }

  async timeline(tenantId: string, conversationId: string): Promise<readonly TimelineEntry[]> {
    const raw = await this.redis.lrange(`${this.prefix}${tenantId}:timeline:${conversationId}`, 0, -1);
    return raw.map((item) => JSON.parse(item) as TimelineEntry);
  }
}

const METRICS_TTL_SECONDS = 45 * 24 * 60 * 60;

/** Um hash por estúdio e dia; HINCRBY é atômico, então vários consumidores somam sem corrida. */
export class RedisMetricsStore implements MetricsStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:metrics:',
  ) {}

  async add(tenantId: string, increments: readonly MetricIncrement[]): Promise<void> {
    const pipeline = this.redis.multi();
    for (const { day, field, by } of increments) {
      const key = `${this.prefix}${tenantId}:${day}`;
      pipeline.hincrby(key, field, by).expire(key, METRICS_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  async read(tenantId: string, days: readonly string[]): Promise<Record<string, Record<string, number>>> {
    const pipeline = this.redis.multi();
    for (const day of days) pipeline.hgetall(`${this.prefix}${tenantId}:${day}`);
    const results = (await pipeline.exec()) ?? [];
    return Object.fromEntries(
      days.map((day, i) => [day, Object.fromEntries(Object.entries((results[i]?.[1] as Record<string, string> | undefined) ?? {}).map(([k, v]) => [k, Number(v)]))]),
    );
  }
}

export class RedisNoticeLedger implements NoticeLedger {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:notice:',
  ) {}

  async claim(key: string): Promise<boolean> {
    return (await this.redis.set(this.prefix + key, '1', 'EX', CONVERSATION_TTL_SECONDS, 'NX')) === 'OK';
  }
}

/** Anotações de mídia por estúdio (um hash por estúdio); somem com o áudio, em 30 dias. */
export class RedisMediaNotes implements MediaNotes {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:media-notes:',
  ) {}

  async save(tenantId: string, messageId: string, note: MediaNote): Promise<void> {
    const key = `${this.prefix}${tenantId}`;
    await this.redis.multi().hset(key, messageId, JSON.stringify(note)).expire(key, CONVERSATION_TTL_SECONDS).exec();
  }

  async find(tenantId: string, messageId: string): Promise<MediaNote | null> {
    const raw = await this.redis.hget(`${this.prefix}${tenantId}`, messageId);
    return raw ? (JSON.parse(raw) as MediaNote) : null;
  }
}
