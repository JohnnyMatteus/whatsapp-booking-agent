import { describe, expect, it } from 'vitest';
import { InMemoryConversationLog, InMemoryConversationRepository, InMemoryHandoffQueue, InMemoryMetricsStore } from '../../src/adapters/persistence/in-memory.js';
import { HandleInboundMessage } from '../../src/application/handle-inbound.js';
import { OutboxRelay } from '../../src/application/outbox-relay.js';
import { ConcurrentModification, type AgentResult, type ConversationAgent, type InboundCommand, type OutboundMessage, type OutboundPublisher, type Turn } from '../../src/application/ports.js';
import { MetricsRecorder } from '../../src/application/metrics-recorder.js';
import { ResumeConversation } from '../../src/application/resume-conversation.js';
import { Conversation } from '../../src/domain/conversation.js';
import { NOW } from '../domain/fixtures.js';

class ScriptedAgent implements ConversationAgent {
  turns: Turn[] = [];
  constructor(private readonly behavior: (conversation: Conversation) => AgentResult) {}
  async respond(conversation: Conversation, turn: Turn): Promise<AgentResult> {
    this.turns.push(turn);
    return this.behavior(conversation);
  }
}

class RecordingPublisher implements OutboundPublisher {
  published: OutboundMessage[] = [];
  failNext = false;
  async publish(messages: readonly OutboundMessage[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('broker fora do ar');
    }
    this.published.push(...messages);
  }
}

const command = (messageId: string, text = 'oi'): InboundCommand => ({
  tenantId: 'estudio-lotus',
  contactId: '5511900000001',
  messageId,
  turn: { kind: 'text', text },
});

function setup(behavior: (c: Conversation) => AgentResult = () => ({ replies: [{ kind: 'text', text: 'Olá!' }], outcome: 'answered', citations: [] })) {
  const conversations = new InMemoryConversationRepository();
  const handoffs = new InMemoryHandoffQueue();
  const publisher = new RecordingPublisher();
  const agent = new ScriptedAgent(behavior);
  const clock = { now: () => NOW };
  const log = new InMemoryConversationLog();
  const metricsStore = new InMemoryMetricsStore();
  const metrics = new MetricsRecorder(metricsStore, 'America/Sao_Paulo');
  const handle = new HandleInboundMessage({ conversations, agent, publisher, outbox: conversations.outbox, handoffs, log, metrics, clock });
  const resume = new ResumeConversation({ conversations, handoffs, publisher, outbox: conversations.outbox, log, metrics, clock });
  const relay = new OutboxRelay({ outbox: conversations.outbox, publisher });
  return { conversations, handoffs, publisher, agent, handle, resume, log, metricsStore, relay };
}

describe('HandleInboundMessage', () => {
  it('responde e ignora a reentrega da mesma mensagem', async () => {
    const t = setup();

    expect(await t.handle.execute(command('wamid.1'))).toBe('answered');
    expect(await t.handle.execute(command('wamid.1'))).toBe('duplicate');

    expect(t.agent.turns).toHaveLength(1);
    expect(t.publisher.published).toEqual([
      { kind: 'reply', member: expect.objectContaining({ contactId: '5511900000001' }), inReplyTo: 'wamid.1', reply: { kind: 'text', text: 'Olá!' } },
    ]);
  });

  it('transferência publica ticket, entra na fila de atendimento e silencia o bot', async () => {
    const t = setup((conversation) => {
      conversation.handOff('explicit_request', NOW);
      return { replies: [{ kind: 'text', text: 'Vou chamar alguém.' }], outcome: 'handed_off', citations: [] };
    });

    await t.handle.execute(command('wamid.1', 'quero um atendente'));
    const later = await t.handle.execute(command('wamid.2', 'alô?'));

    expect(later).toBe('silenced');
    expect(t.agent.turns).toHaveLength(1);
    expect(t.publisher.published.map((m) => m.kind)).toEqual(['reply', 'handoff']);
    // A mensagem recebida depois da transferência fica registrada para o atendente ler.
    expect((await t.log.timeline('estudio-lotus', 'estudio-lotus:5511900000001')).map((e) => e.kind)).toEqual(['student', 'bot', 'handoff', 'student']);
    expect((await t.log.summaries('estudio-lotus'))[0]).toMatchObject({ status: 'handed_off', lastMessage: { author: 'student', preview: 'alô?' } });
    expect(await t.handoffs.list('estudio-lotus')).toEqual([
      expect.objectContaining({ conversationId: 'estudio-lotus:5511900000001', reason: 'explicit_request' }),
    ]);
  });

  it('se publicar falhar, o turno vale e a resposta fica na caixa de saída até o varredor publicá-la, uma vez', async () => {
    const t = setup();
    t.publisher.failNext = true;

    expect(await t.handle.execute(command('wamid.1'))).toBe('answered');
    expect(t.publisher.published).toEqual([]);
    expect(t.conversations.outbox.entries.size).toBe(1);
    // A reentrega da mesma mensagem é duplicata: o agente não roda de novo e a resposta não se perde.
    expect(await t.handle.execute(command('wamid.1'))).toBe('duplicate');
    expect(t.agent.turns).toHaveLength(1);

    t.conversations.outbox.expireLeases();
    expect(await t.relay.sweep()).toBe(1);
    expect(await t.relay.sweep()).toBe(0);
    expect(t.publisher.published).toHaveLength(1);
    expect(t.conversations.outbox.entries.size).toBe(0);
  });

  it('conflito de versão não publica nada: a reentrega refaz o turno e só então a resposta sai', async () => {
    const t = setup();
    // Outro consumidor grava a mesma conversa entre o load e o save deste turno.
    const original = t.conversations.save.bind(t.conversations);
    let interfered = false;
    t.conversations.save = async (conversation, outbox) => {
      if (!interfered) {
        interfered = true;
        const rival = await t.conversations.load('estudio-lotus', '5511900000001');
        const fresh = rival ?? Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
        fresh.receive('wamid.rival');
        await original(fresh);
      }
      return original(conversation, outbox);
    };

    await expect(t.handle.execute(command('wamid.1'))).rejects.toBeInstanceOf(ConcurrentModification);
    expect(t.publisher.published).toEqual([]);
    expect(t.conversations.outbox.entries.size).toBe(0);

    expect(await t.handle.execute(command('wamid.1'))).toBe('answered');
    expect(t.publisher.published).toHaveLength(1);
  });

  it('o atendente devolve a conversa ao bot e o ticket sai da fila', async () => {
    let handOff = true;
    const t = setup((conversation) => {
      if (handOff) conversation.handOff('sensitive_topic', NOW);
      return { replies: [], outcome: handOff ? 'handed_off' : 'answered', citations: [] };
    });
    await t.handle.execute(command('wamid.1'));

    await t.resume.execute('estudio-lotus', '5511900000001');
    handOff = false;

    expect(await t.handoffs.list('estudio-lotus')).toEqual([]);
    expect(await t.handle.execute(command('wamid.2'))).toBe('answered');
    expect(t.publisher.published.some((m) => m.kind === 'reply' && m.reply.kind === 'text' && /Voltei a atender/.test(m.reply.text))).toBe(true);
    expect((await t.log.timeline('estudio-lotus', 'estudio-lotus:5511900000001')).map((e) => e.kind)).toContain('resumed');
  });

  it('devolver ao bot com o broker fora: a conversa volta e o aviso fica na caixa de saída até o varredor', async () => {
    const t = setup((conversation) => {
      conversation.handOff('explicit_request', NOW);
      return { replies: [], outcome: 'handed_off', citations: [] };
    });
    await t.handle.execute(command('wamid.1'));
    t.publisher.published.length = 0;
    t.publisher.failNext = true;

    await t.resume.execute('estudio-lotus', '5511900000001');

    expect((await t.conversations.load('estudio-lotus', '5511900000001'))?.status).toBe('bot_active');
    expect(t.conversations.outbox.entries.size).toBe(1);
    t.conversations.outbox.expireLeases();
    expect(await t.relay.sweep()).toBe(1);
    expect(t.publisher.published.some((m) => m.kind === 'reply' && m.reply.kind === 'text' && /Voltei a atender/.test(m.reply.text))).toBe(true);
  });

  it('recusa devolver conversa inexistente', async () => {
    const t = setup();

    await expect(t.resume.execute('estudio-lotus', 'desconhecido')).rejects.toMatchObject({ code: 'not_found' });
  });
});
