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
export const CONVERSATION_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * Prazo dos modelos de leitura do painel (resumo, linha do tempo, ticket de atendimento). Uma hora a menos que o
 * da conversa: eles são gravados depois dela, então expiram antes, e o item que a fila lista sempre tem detalhe.
 */
export const READ_MODEL_TTL_SECONDS = CONVERSATION_TTL_SECONDS - 60 * 60;
const SECOND_MS = 1000;

/**
 * Hash por estúdio em que cada campo tem o seu prazo (HEXPIRE, Redis 7.4+): a atividade de uma conversa não
 * renova a de outra, e nada com telefone ou texto sobrevive ao prazo. Campos gravados antes dessa mudança não
 * têm prazo; `readFieldsAdoptingLegacy` dá a eles o prazo que teriam tido, ou os apaga se já passaram dele.
 */
async function setFieldWithTtl(redis: Redis, key: string, field: string, value: string, mode: 'overwrite' | 'keep-first'): Promise<void> {
  if (mode === 'overwrite') {
    // HSET num campo existente apaga o prazo dele; o HEXPIRE seguinte o põe de novo.
    await redis.hset(key, field, value);
    await redis.hexpire(key, READ_MODEL_TTL_SECONDS, 'FIELDS', 1, field);
  } else {
    // O campo mantido conserva o prazo original (NX: só define prazo se ainda não houver).
    await redis.hsetnx(key, field, value);
    await redis.hexpire(key, READ_MODEL_TTL_SECONDS, 'NX', 'FIELDS', 1, field);
  }
}

async function readFieldsAdoptingLegacy<T>(redis: Redis, key: string, timestampOf: (value: T) => string, now: Date): Promise<T[]> {
  const entries = Object.entries(await redis.hgetall(key));
  if (entries.length === 0) return [];
  const ttls = await redis.httl(key, 'FIELDS', entries.length, ...entries.map(([field]) => field));
  const kept: T[] = [];
  for (const [i, [field, raw]] of entries.entries()) {
    const value = JSON.parse(raw) as T;
    if (ttls[i] !== -1) {
      kept.push(value);
      continue;
    }
    const remaining = Math.ceil((Date.parse(timestampOf(value)) + READ_MODEL_TTL_SECONDS * SECOND_MS - now.getTime()) / SECOND_MS);
    if (remaining <= 0 || Number.isNaN(remaining)) {
      await redis.hdel(key, field);
      continue;
    }
    await redis.hexpire(key, remaining, 'FIELDS', 1, field);
    kept.push(value);
  }
  return kept;
}

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

/**
 * Fila por estúdio: um hash de tickets em que cada ticket tem o seu prazo. A ordem (mais antigo primeiro) sai do
 * `requestedAt` do ticket; o sorted set antigo, sem prazo e com o telefone como membro, é apagado ao primeiro uso.
 */
export class RedisHandoffQueue implements HandoffQueue {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:handoffs:',
  ) {}

  private ticketsKey(tenantId: string): string {
    return `${this.prefix}${tenantId}:tickets`;
  }

  private async dropLegacyOrder(tenantId: string): Promise<void> {
    await this.redis.del(`${this.prefix}${tenantId}:order`);
  }

  async enqueue(ticket: HandoffTicket): Promise<void> {
    await this.dropLegacyOrder(ticket.tenantId);
    // O primeiro pedido vale: reenfileirar a mesma conversa não muda a posição nem o prazo.
    await setFieldWithTtl(this.redis, this.ticketsKey(ticket.tenantId), ticket.conversationId, JSON.stringify(ticket), 'keep-first');
  }

  async list(tenantId: string, now = new Date()): Promise<readonly HandoffTicket[]> {
    await this.dropLegacyOrder(tenantId);
    const tickets = await readFieldsAdoptingLegacy<HandoffTicket>(this.redis, this.ticketsKey(tenantId), (t) => t.requestedAt, now);
    return tickets.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async remove(tenantId: string, conversationId: string): Promise<void> {
    await this.dropLegacyOrder(tenantId);
    await this.redis.hdel(this.ticketsKey(tenantId), conversationId);
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
      pipeline.rpush(timelineKey, ...entries.map((e) => JSON.stringify(e))).ltrim(timelineKey, -TIMELINE_LIMIT, -1).expire(timelineKey, READ_MODEL_TTL_SECONDS);
    }
    await pipeline.exec();
    const timeline = await this.timeline(conversation.tenantId, conversation.id);
    await setFieldWithTtl(this.redis, `${this.prefix}${conversation.tenantId}:summaries`, conversation.id, JSON.stringify(summarize(conversation, timeline)), 'overwrite');
  }

  async summaries(tenantId: string, now = new Date()): Promise<readonly ConversationSummary[]> {
    return readFieldsAdoptingLegacy<ConversationSummary>(this.redis, `${this.prefix}${tenantId}:summaries`, (s) => s.updatedAt, now);
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

/** Prazo de retenção da anotação de mídia: o id da mensagem do WhatsApp carrega o telefone do aluno. */
export const MEDIA_NOTE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Uma chave por mensagem, cada uma com o seu prazo de 30 dias a partir do próprio `save`. Um hash por
 * estúdio com EXPIRE renovaria o prazo a cada nota nova e nada expiraria num estúdio ativo.
 */
export class RedisMediaNotes implements MediaNotes {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:media-notes:',
  ) {}

  private key(tenantId: string, messageId: string): string {
    return `${this.prefix}${tenantId}:${messageId}`;
  }

  async save(tenantId: string, messageId: string, note: MediaNote): Promise<void> {
    await this.redis.set(this.key(tenantId, messageId), JSON.stringify(note), 'EX', MEDIA_NOTE_TTL_SECONDS);
  }

  async find(tenantId: string, messageId: string): Promise<MediaNote | null> {
    const raw = await this.redis.get(this.key(tenantId, messageId));
    return raw ? (JSON.parse(raw) as MediaNote) : null;
  }

  async findMany(tenantId: string, messageIds: readonly string[]): Promise<ReadonlyMap<string, MediaNote>> {
    if (messageIds.length === 0) return new Map();
    const raw = await this.redis.mget(...messageIds.map((id) => this.key(tenantId, id)));
    return new Map(messageIds.flatMap((id, i) => (raw[i] ? [[id, JSON.parse(raw[i]) as MediaNote] as const] : [])));
  }
}
