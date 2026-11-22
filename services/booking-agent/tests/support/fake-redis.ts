// Redis falso com relógio controlável, só o que os modelos de leitura usam: hashes com prazo por campo
// (HEXPIRE/HTTL, como no Redis 7.4), listas com prazo por chave e DEL. O comportamento real é coberto em
// tests/integration, contra um Redis de verdade.
import type { Redis } from 'ioredis';

interface Field {
  value: string;
  expiresAt: number | null;
}

export class FakeRedis {
  now = 0;
  readonly commands: string[] = [];
  private readonly hashes = new Map<string, Map<string, Field>>();
  private readonly lists = new Map<string, { items: string[]; expiresAt: number | null }>();

  advance(ms: number): void {
    this.now += ms;
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }

  private hash(key: string, create = false): Map<string, Field> | undefined {
    let hash = this.hashes.get(key);
    if (!hash && create) this.hashes.set(key, (hash = new Map()));
    if (!hash) return undefined;
    for (const [name, field] of hash) if (field.expiresAt !== null && field.expiresAt <= this.now) hash.delete(name);
    if (hash.size === 0 && !create) this.hashes.delete(key);
    return hash;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.commands.push(`hset ${key}`);
    const hash = this.hash(key, true)!;
    const existed = hash.has(field);
    hash.set(field, { value, expiresAt: null });
    return existed ? 0 : 1;
  }

  async hsetnx(key: string, field: string, value: string): Promise<number> {
    const hash = this.hash(key, true)!;
    if (hash.has(field)) return 0;
    hash.set(field, { value, expiresAt: null });
    return 1;
  }

  async hexpire(key: string, seconds: number, ...rest: (string | number)[]): Promise<number[]> {
    const nx = rest[0] === 'NX';
    const [, count, ...fields] = nx ? rest.slice(1) : rest;
    const hash = this.hash(key);
    return fields.slice(0, Number(count)).map((name) => {
      const field = hash?.get(String(name));
      if (!field) return -2;
      if (nx && field.expiresAt !== null) return 0;
      field.expiresAt = this.now + seconds * 1000;
      return 1;
    });
  }

  async httl(key: string, _fields: 'FIELDS', count: number, ...names: string[]): Promise<number[]> {
    const hash = this.hash(key);
    return names.slice(0, count).map((name) => {
      const field = hash?.get(name);
      if (!field) return -2;
      return field.expiresAt === null ? -1 : Math.ceil((field.expiresAt - this.now) / 1000);
    });
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries([...(this.hash(key)?.entries() ?? [])].map(([name, field]) => [name, field.value]));
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.hash(key)?.delete(field) ? 1 : 0;
  }

  async del(key: string): Promise<number> {
    this.commands.push(`del ${key}`);
    return (this.hashes.delete(key) ? 1 : 0) + (this.lists.delete(key) ? 1 : 0);
  }

  private readonly strings = new Map<string, { value: string; expiresAt: number | null }>();

  /** SET key value PX|EX n [NX]: o suficiente para o lock por contato. */
  async set(key: string, value: string, unit: 'PX' | 'EX', amount: number, nx?: 'NX'): Promise<'OK' | null> {
    const current = this.strings.get(key);
    const live = current && (current.expiresAt === null || current.expiresAt > this.now);
    if (nx === 'NX' && live) return null;
    this.strings.set(key, { value, expiresAt: this.now + amount * (unit === 'EX' ? 1000 : 1) });
    return 'OK';
  }

  /** Só o script de liberação do lock: apaga a chave se o valor for o do dono. */
  async eval(_script: string, _keys: number, key: string, token: string): Promise<number> {
    const current = this.strings.get(key);
    if (current?.value !== token) return 0;
    this.strings.delete(key);
    return 1;
  }

  hasString(key: string): boolean {
    const current = this.strings.get(key);
    return current !== undefined && (current.expiresAt === null || current.expiresAt > this.now);
  }

  /** Só rpush, ltrim e expire encadeados, como o RedisConversationLog usa. */
  multi() {
    const steps: (() => void)[] = [];
    const chain = {
      rpush: (key: string, ...items: string[]) => (steps.push(() => this.list(key, true)!.items.push(...items)), chain),
      ltrim: (key: string, start: number) => (steps.push(() => { const l = this.list(key)!; l.items = l.items.slice(start); }), chain),
      expire: (key: string, seconds: number) => (steps.push(() => { this.list(key)!.expiresAt = this.now + seconds * 1000; }), chain),
      exec: async () => (steps.forEach((step) => step()), []),
    };
    return chain;
  }

  private list(key: string, create = false) {
    let list = this.lists.get(key);
    if (list?.expiresAt != null && list.expiresAt <= this.now) {
      this.lists.delete(key);
      list = undefined;
    }
    if (!list && create) this.lists.set(key, (list = { items: [], expiresAt: null }));
    return list;
  }

  async lrange(key: string): Promise<string[]> {
    return [...(this.list(key)?.items ?? [])];
  }

  /** Para os testes: o campo existe no hash? */
  has(key: string, field: string): boolean {
    return this.hash(key)?.has(field) ?? false;
  }

  listExists(key: string): boolean {
    return this.list(key) !== undefined;
  }
}
