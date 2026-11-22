// Mídia entregue dentro do webhook (Whatsmiau com base64) fica pouco tempo no Redis, até o
// media-processor pedir os bytes. O TTL curto evita reter áudio de aluno (dado pessoal).
import type { Redis } from 'ioredis';
import type { CachedMedia, InboundMediaCache } from '../ports.js';

export class RedisMediaCache implements InboundMediaCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:media:',
  ) {}

  async put(key: string, entry: CachedMedia, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(entry), 'EX', ttlSeconds);
  }

  async get(key: string): Promise<CachedMedia | null> {
    const raw = await this.redis.get(this.prefix + key);
    return raw === null ? null : (JSON.parse(raw) as CachedMedia);
  }
}

export class InMemoryMediaCache implements InboundMediaCache {
  private readonly entries = new Map<string, CachedMedia>();

  async put(key: string, entry: CachedMedia): Promise<void> {
    this.entries.set(key, entry);
  }

  async get(key: string): Promise<CachedMedia | null> {
    return this.entries.get(key) ?? null;
  }
}
