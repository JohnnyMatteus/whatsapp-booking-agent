// Persistência da conversa e da fila de atendimento no Redis.
import type { Redis } from 'ioredis';
import { ConcurrentModification, type ConversationRepository, type HandoffQueue, type HandoffTicket } from '../../application/ports.js';
import { Conversation, type ConversationSnapshot } from '../../domain/conversation.js';

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
