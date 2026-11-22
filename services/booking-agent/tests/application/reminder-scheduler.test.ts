import { describe, expect, it } from 'vitest';
import { InMemoryConversationLog, InMemoryConversationRepository, InMemoryMetricsStore, InMemoryNoticeLedger } from '../../src/adapters/persistence/in-memory.js';
import { MetricsRecorder } from '../../src/application/metrics-recorder.js';
import { NotifyStudent } from '../../src/application/notify-student.js';
import type { OutboundMessage } from '../../src/application/ports.js';
import { ReminderScheduler } from '../../src/application/reminder-scheduler.js';
import { Conversation } from '../../src/domain/conversation.js';
import { aSession, NOW } from '../domain/fixtures.js';
import { FakeSchedulingTools } from '../support/fake-tools.js';

async function setup(startsAt: Date, booking: { id: string; status: 'confirmed' | 'waitlisted' } | null = { id: 'bk-1', status: 'confirmed' }) {
  const session = aSession({ startsAt, endsAt: new Date(startsAt.getTime() + 3600_000) });
  const conversations = new InMemoryConversationRepository();
  const log = new InMemoryConversationLog();
  const published: OutboundMessage[] = [];
  const conversation = Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
  conversation.offerSlots([{ session, booking }], NOW);
  await conversations.save(conversation);
  await log.record(conversation, []);
  const clock = { now: () => NOW };
  const notify = new NotifyStudent({
    tools: new FakeSchedulingTools([{ session, myBooking: booking }]),
    conversations,
    publisher: { publish: async (m) => void published.push(...m) },
    log,
    metrics: new MetricsRecorder(new InMemoryMetricsStore(), 'America/Sao_Paulo'),
    ledger: new InMemoryNoticeLedger(),
    clock,
    timezone: 'America/Sao_Paulo',
  });
  return { scheduler: new ReminderScheduler({ log, conversations, notify, clock }), published };
}

describe('lembretes de aula', () => {
  it('avisa quem tem reserva confirmada nas próximas 24 h e não repete no ciclo seguinte', async () => {
    const t = await setup(new Date(NOW.getTime() + 20 * 3600_000));

    expect(await t.scheduler.tick('estudio-lotus')).toBe(1);
    expect(await t.scheduler.tick('estudio-lotus')).toBe(0);
    expect(t.published).toHaveLength(1);
  });

  it('ignora aula distante, aula iminente e reserva em lista de espera', async () => {
    expect(await (await setup(new Date(NOW.getTime() + 48 * 3600_000))).scheduler.tick('estudio-lotus')).toBe(0);
    expect(await (await setup(new Date(NOW.getTime() + 20 * 60_000))).scheduler.tick('estudio-lotus')).toBe(0);
    expect(await (await setup(new Date(NOW.getTime() + 20 * 3600_000), { id: 'bk-2', status: 'waitlisted' })).scheduler.tick('estudio-lotus')).toBe(0);
  });
});
