// Caixa de saída e exclusão mútua por contato (ADR 0014), sem broker nem Redis real. O script Lua do salvar
// atômico e o lock no Redis de verdade são cobertos em tests/integration.
import { createLogger } from '@wba/observability';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryContactLock, InMemoryMediaNotes, InMemoryOutbox } from '../../src/adapters/persistence/in-memory.js';
import { createInboundHandler } from '../../src/adapters/messaging/consumer.js';
import { RedisContactLock } from '../../src/adapters/persistence/redis.js';
import { OutboxRelay } from '../../src/application/outbox-relay.js';
import { ContactBusy, type OutboundMessage, type OutboundPublisher, type OutboxEntry } from '../../src/application/ports.js';
import { FakeRedis } from '../support/fake-redis.js';
import { createEnvelope, MessageType } from '@wba/contracts';
import { NOW } from '../domain/fixtures.js';

const entry = (id: string): OutboxEntry => ({
  id,
  correlationId: `wamid.${id}`,
  messages: [{ kind: 'reply', member: { tenantId: 'estudio-lotus', contactId: '5511900000001' }, reply: { kind: 'text', text: 'oi' } } satisfies OutboundMessage],
});

class Publisher implements OutboundPublisher {
  readonly published: string[] = [];
  failures = 0;
  async publish(_messages: readonly OutboundMessage[], correlationId: string): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('broker fora');
    }
    this.published.push(correlationId);
  }
}

describe('OutboxRelay', () => {
  it('publica e tira da caixa; falha deixa a entrada para o varredor, que só a pega quando a reserva vence', async () => {
    const outbox = new InMemoryOutbox();
    const publisher = new Publisher();
    const errors: unknown[] = [];
    const relay = new OutboxRelay({ outbox, publisher, onError: (e) => errors.push(e) });
    outbox.add(entry('a'));
    publisher.failures = 1;

    expect(await relay.sweep()).toBe(0);
    expect(errors).toHaveLength(1);
    expect(outbox.entries.has('a')).toBe(true);
    expect(await relay.sweep()).toBe(0); // reserva ainda valendo

    outbox.expireLeases();
    expect(await relay.sweep()).toBe(1);
    expect(publisher.published).toEqual(['wamid.a']);
    expect(outbox.entries.size).toBe(0);
  });

  it('entrada concluída durante a varredura não é publicada de novo (publicador lento, turno entregando a última)', async () => {
    const outbox = new InMemoryOutbox();
    const published: string[] = [];
    const slow: OutboundPublisher = {
      async publish(_messages, correlationId) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        published.push(correlationId);
      },
    };
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (const id of ids) outbox.add(entry(id));
    const sweeper = new OutboxRelay({ outbox, publisher: slow });
    const turn = new OutboxRelay({ outbox, publisher: slow });

    // O varredor leu as 10 pendentes e está publicando as primeiras; o turno entrega a última e a conclui.
    const sweeping = sweeper.sweep();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await turn.deliver(entry('j'));
    await sweeping;

    expect([...published].sort()).toEqual(ids.map((id) => `wamid.${id}`));
    expect(outbox.entries.size).toBe(0);
  });

  it('varreduras sobrepostas no mesmo processo (setInterval) esperam a primeira e não repetem nada', async () => {
    const outbox = new InMemoryOutbox();
    const published: string[] = [];
    const slow: OutboundPublisher = {
      async publish(_messages, correlationId) {
        await new Promise((resolve) => setTimeout(resolve, 3));
        published.push(correlationId);
      },
    };
    for (const id of ['a', 'b', 'c']) outbox.add(entry(id));
    const relay = new OutboxRelay({ outbox, publisher: slow });

    const results = await Promise.all([relay.sweep(), relay.sweep(), relay.sweep()]);

    expect(results).toEqual([3, 3, 3]);
    expect([...published].sort()).toEqual(['wamid.a', 'wamid.b', 'wamid.c']);
    expect(await relay.sweep()).toBe(0);
  });

  it('duas instâncias varrendo ao mesmo tempo não publicam a mesma entrada duas vezes', async () => {
    const outbox = new InMemoryOutbox();
    const publisher = new Publisher();
    outbox.add(entry('a'));
    outbox.add(entry('b'));

    const [first, second] = await Promise.all([new OutboxRelay({ outbox, publisher }).sweep(), new OutboxRelay({ outbox, publisher }).sweep()]);

    expect(first + second).toBe(2);
    expect([...publisher.published].sort()).toEqual(['wamid.a', 'wamid.b']);
  });
});

describe('exclusão mútua por contato', () => {
  const trace = () => {
    const events: string[] = [];
    const work = (name: string, ms = 5) => async () => {
      events.push(`${name}:início`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${name}:fim`);
    };
    return { events, work };
  };

  it.each([
    ['em memória', () => new InMemoryContactLock()],
    ['no Redis', () => new RedisContactLock(new FakeRedis().asRedis(), { pollMs: 1, waitMs: 2000 })],
  ])('(%s) mensagens do mesmo contato rodam uma de cada vez; contatos diferentes seguem em paralelo', async (_name, make) => {
    const lock = make();
    const same = trace();

    await Promise.all([lock.withLock('t', 'c1', same.work('a')), lock.withLock('t', 'c1', same.work('b'))]);
    expect(same.events).toEqual(['a:início', 'a:fim', 'b:início', 'b:fim']);

    const other = trace();
    await Promise.all([lock.withLock('t', 'c1', other.work('a')), lock.withLock('t', 'c2', other.work('b'))]);
    expect(other.events.slice(0, 2).sort()).toEqual(['a:início', 'b:início']);
  });

  it('o mesmo contato em outro estúdio não espera', async () => {
    const lock = new RedisContactLock(new FakeRedis().asRedis(), { pollMs: 1, waitMs: 2000 });
    const events = trace();

    await Promise.all([lock.withLock('estudio-lotus', 'c1', events.work('a')), lock.withLock('estudio-sol', 'c1', events.work('b'))]);

    expect(events.events.slice(0, 2).sort()).toEqual(['a:início', 'b:início']);
  });

  it('libera o lock quando o trabalho falha', async () => {
    const redis = new FakeRedis();
    const lock = new RedisContactLock(redis.asRedis(), { pollMs: 1, waitMs: 50 });

    await expect(lock.withLock('t', 'c1', async () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');

    expect(redis.hasString('wba:lock:t:c1')).toBe(false);
    await expect(lock.withLock('t', 'c1', async () => 'ok')).resolves.toBe('ok');
  });

  it('desiste com ContactBusy depois de esperar o prazo (a fila reentrega depois)', async () => {
    const redis = new FakeRedis();
    let clock = 0;
    const lock = new RedisContactLock(redis.asRedis(), { waitMs: 100, pollMs: 10, now: () => clock, sleep: async (ms) => void (clock += ms) });
    await redis.set('wba:lock:t:c1', 'outro-dono', 'PX', 60_000, 'NX');

    await expect(lock.withLock('t', 'c1', async () => 'nunca')).rejects.toBeInstanceOf(ContactBusy);
  });

  it('não solta o lock de outro dono: lock vencido e retomado por outra instância continua dela', async () => {
    const redis = new FakeRedis();
    const lock = new RedisContactLock(redis.asRedis(), { ttlMs: 10, pollMs: 1, waitMs: 50 });

    await lock.withLock('t', 'c1', async () => {
      redis.advance(20); // o lock vence no meio do turno
      await redis.set('wba:lock:t:c1', 'outra-instancia', 'PX', 60_000, 'NX');
    });

    expect(redis.hasString('wba:lock:t:c1')).toBe(true);
  });
});

describe('consumidor com lock por contato', () => {
  it('duas mensagens do mesmo contato não rodam o caso de uso ao mesmo tempo', async () => {
    let running = 0;
    let peak = 0;
    const useCase = {
      execute: vi.fn(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return 'answered' as const;
      }),
    };
    const handle = createInboundHandler({
      useCase: useCase as never,
      metrics: { turns: { inc: vi.fn() }, turnDuration: { startTimer: () => () => 0 } } as never,
      recorder: {} as never,
      mediaNotes: new InMemoryMediaNotes(),
      locks: new InMemoryContactLock(),
      logger: createLogger('test'),
      tracer: { startActiveSpan: (_n: string, _o: unknown, fn: (span: unknown) => unknown) => fn({ end: () => undefined, setStatus: () => undefined, recordException: () => undefined, setAttribute: () => undefined }) } as never,
    });
    const message = (id: string) =>
      createEnvelope(
        MessageType.MessageReceived,
        { tenantId: 'estudio-lotus', contactId: '5511900000001', messageId: id, receivedAt: NOW.toISOString(), content: { kind: 'text', text: 'oi', transcribed: false } },
        { id: `e-${id}`, correlationId: id, occurredAt: NOW },
      );

    await Promise.all([handle(message('wamid.1')), handle(message('wamid.2'))]);

    expect(useCase.execute).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
});

describe('contato ocupado no consumidor', () => {
  it('vira Deferred (retry sem gastar tentativa), não uma falha comum', async () => {
    const { Deferred } = await import('@wba/messaging');
    const handle = createInboundHandler({
      useCase: { execute: vi.fn() } as never,
      metrics: {} as never,
      recorder: {} as never,
      mediaNotes: new InMemoryMediaNotes(),
      locks: { withLock: () => Promise.reject(new ContactBusy()) },
      logger: createLogger('test'),
      tracer: {} as never,
    });
    const envelope = createEnvelope(
      MessageType.MessageReceived,
      { tenantId: 'estudio-lotus', contactId: '5511900000001', messageId: 'wamid.1', receivedAt: NOW.toISOString(), content: { kind: 'text', text: 'oi', transcribed: false } },
      { id: 'e-1', correlationId: 'wamid.1', occurredAt: NOW },
    );

    await expect(handle(envelope)).rejects.toBeInstanceOf(Deferred);
  });
});
