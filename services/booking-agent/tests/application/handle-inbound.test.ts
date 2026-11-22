import { describe, expect, it } from 'vitest';
import { InMemoryConversationLog, InMemoryConversationRepository, InMemoryHandoffQueue, InMemoryMetricsStore } from '../../src/adapters/persistence/in-memory.js';
import { HandleInboundMessage } from '../../src/application/handle-inbound.js';
import type { AgentResult, ConversationAgent, InboundCommand, OutboundMessage, OutboundPublisher, Turn } from '../../src/application/ports.js';
import { MetricsRecorder } from '../../src/application/metrics-recorder.js';
import { ResumeConversation } from '../../src/application/resume-conversation.js';
import type { Conversation } from '../../src/domain/conversation.js';
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
  const handle = new HandleInboundMessage({ conversations, agent, publisher, handoffs, log, metrics, clock });
  const resume = new ResumeConversation({ conversations, handoffs, publisher, log, metrics, clock });
  return { conversations, handoffs, publisher, agent, handle, resume, log, metricsStore };
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

  it('se publicar falhar, não marca a mensagem como processada (a reentrega tenta de novo)', async () => {
    const t = setup();
    t.publisher.failNext = true;

    await expect(t.handle.execute(command('wamid.1'))).rejects.toThrow('broker fora do ar');
    expect(await t.handle.execute(command('wamid.1'))).toBe('answered');
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

  it('recusa devolver conversa inexistente', async () => {
    const t = setup();

    await expect(t.resume.execute('estudio-lotus', 'desconhecido')).rejects.toMatchObject({ code: 'not_found' });
  });
});
