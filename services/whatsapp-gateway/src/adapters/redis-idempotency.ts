// Idempotência no Redis: SET NX com expiração. A Meta reentrega webhooks por até 7 dias,
// então a chave vive o mesmo tempo.
import type { Redis } from 'ioredis';
import type { IdempotencyStore } from '../ports.js';

export const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wba:webhook:seen:',
  ) {}

  async claim(key: string): Promise<boolean> {
    const result = await this.redis.set(this.prefix + key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  async release(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  async release(key: string): Promise<void> {
    this.seen.delete(key);
  }
}
