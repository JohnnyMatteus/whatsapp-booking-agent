import { LangGraphConversationAgent, type AgentObserver } from '../../src/agent/graph.js';
import type { Reply, SessionListing, Turn } from '../../src/application/ports.js';
import { Conversation } from '../../src/domain/conversation.js';
import { aSession, fullSession, NOW } from '../domain/fixtures.js';
import { FakeLlmClient } from '../support/fake-llm.js';
import { FakeSchedulingTools } from '../support/fake-tools.js';

export const TZ = 'America/Sao_Paulo';

/** Grade padrão: Hatha com vaga (ter 03/03 18:00 local) e Pilates lotado (qua 04/03 07:00 local). */
export const defaultListing = (): SessionListing[] => [
  { session: aSession(), myBooking: null },
  {
    session: fullSession({ id: 'ses-pilates-1', title: 'Pilates Solo', startsAt: new Date('2026-03-04T10:00:00Z'), endsAt: new Date('2026-03-04T11:00:00Z') }),
    myBooking: null,
  },
];

export function setup(options: { llm?: (string | object)[]; listing?: SessionListing[] } = {}) {
  const llm = new FakeLlmClient(options.llm ?? []);
  const tools = new FakeSchedulingTools(options.listing ?? defaultListing());
  const events: Parameters<AgentObserver['turnFinished']>[0][] = [];
  const rejected: string[] = [];
  let now = NOW;
  const agent = new LangGraphConversationAgent({
    tools,
    llm,
    timezone: TZ,
    clock: { now: () => now },
    observer: { turnFinished: (info) => events.push(info), llmRejected: (stage) => rejected.push(stage) },
  });
  const conversation = Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
  return {
    llm,
    tools,
    events,
    rejected,
    conversation,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    say: (text: string) => agent.respond(conversation, { kind: 'text', text }),
    act: (turn: Turn) => agent.respond(conversation, turn),
  };
}

export function allText(reply: Reply): string {
  return reply.kind === 'text' ? reply.text : [reply.body, ...reply.choices.map((c) => `${c.title} ${c.description ?? ''}`)].join(' | ');
}
