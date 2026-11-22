// Retenção das anotações de mídia: uma chave por mensagem, prazo próprio, isolamento por estúdio.
// Redis falso mínimo que registra o prazo de cada chave; o Redis real é coberto em tests/integration.
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { MEDIA_NOTE_TTL_SECONDS, RedisMediaNotes } from '../../src/adapters/persistence/redis.js';
import type { MediaNote } from '../../src/application/ports.js';

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly commands: string[] = [];

  async set(key: string, value: string, mode: string, seconds: number): Promise<'OK'> {
    this.commands.push(`set ${key} ${mode} ${String(seconds)}`);
    this.values.set(key, value);
    this.ttls.set(key, seconds);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((key) => this.values.get(key) ?? null);
  }
  // Qualquer uso de hash ou EXPIRE por estúdio é o defeito que este teste existe para impedir.
  async hset(): Promise<never> {
    throw new Error('hash por estúdio não deve ser usado');
  }
  async expire(): Promise<never> {
    throw new Error('EXPIRE separado não deve ser usado');
  }
}

const note = (key: string | null): MediaNote => ({ kind: 'image', status: 'processed', rejectionReason: null, transcribed: false, thumbnailKey: key });
const setup = () => {
  const redis = new FakeRedis();
  return { redis, notes: new RedisMediaNotes(redis as unknown as Redis) };
};

describe('RedisMediaNotes', () => {
  it('cada nota é uma chave própria com o prazo de 30 dias; salvar outra não toca no prazo da primeira', async () => {
    const { redis, notes } = setup();

    await notes.save('estudio-lotus', 'wamid.A', note('media/estudio-lotus/d/a.thumb.jpg'));
    const before = redis.ttls.get('wba:media-notes:estudio-lotus:wamid.A');
    await notes.save('estudio-lotus', 'wamid.B', note(null));

    expect(before).toBe(MEDIA_NOTE_TTL_SECONDS);
    expect(redis.ttls.get('wba:media-notes:estudio-lotus:wamid.A')).toBe(MEDIA_NOTE_TTL_SECONDS);
    expect(redis.commands).toEqual([
      `set wba:media-notes:estudio-lotus:wamid.A EX ${String(MEDIA_NOTE_TTL_SECONDS)}`,
      `set wba:media-notes:estudio-lotus:wamid.B EX ${String(MEDIA_NOTE_TTL_SECONDS)}`,
    ]);
    expect(MEDIA_NOTE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('a mesma mensagem em outro estúdio é outra nota', async () => {
    const { notes } = setup();
    await notes.save('estudio-lotus', 'wamid.A', note('media/estudio-lotus/d/a.thumb.jpg'));

    expect(await notes.find('estudio-sol', 'wamid.A')).toBeNull();
    expect((await notes.findMany('estudio-sol', ['wamid.A'])).size).toBe(0);
    expect(await notes.find('estudio-lotus', 'wamid.A')).toEqual(note('media/estudio-lotus/d/a.thumb.jpg'));
  });

  it('findMany traz só as mensagens com nota, numa ida só', async () => {
    const { notes } = setup();
    await notes.save('estudio-lotus', 'wamid.A', note(null));

    const found = await notes.findMany('estudio-lotus', ['wamid.A', 'wamid.sem-nota']);

    expect([...found.keys()]).toEqual(['wamid.A']);
    expect((await notes.findMany('estudio-lotus', [])).size).toBe(0);
  });
});
