import { createMetricsRegistry } from '@wba/observability';
import { createJwtVerifier } from '../../src/adapters/http/auth.js';
import { buildPanelApi } from '../../src/adapters/http/server.js';
import { InMemoryConversationLog, InMemoryConversationRepository, InMemoryHandoffQueue, InMemoryMediaNotes, InMemoryMetricsStore, InMemoryNoticeLedger } from '../../src/adapters/persistence/in-memory.js';
import { HandleInboundMessage } from '../../src/application/handle-inbound.js';
import { MetricsRecorder } from '../../src/application/metrics-recorder.js';
import { NotifyStudent } from '../../src/application/notify-student.js';
import { PanelQueries } from '../../src/application/panel-queries.js';
import type { AgentResult, ConversationAgent, OutboundMessage, OutboundPublisher } from '../../src/application/ports.js';
import { ReplyAsAttendant } from '../../src/application/reply-as-attendant.js';
import { ResumeConversation } from '../../src/application/resume-conversation.js';
import { aSession, NOW } from '../domain/fixtures.js';
import { FakeSchedulingTools } from './fake-tools.js';
import { AUDIENCE, createTestIdp, ISSUER, type TestIdp } from './tokens.js';

export const TENANT = 'estudio-lotus';
export const CONTACT = '5511900000001';
export const CONVERSATION = encodeURIComponent(`${TENANT}:${CONTACT}`);
export const THUMBNAIL_KEY = `media/${TENANT}/2026-03-02/m1.thumb.jpg`;
export const internal = { authorization: 'Bearer dev-only-internal-token' };

export async function setup(options: { handedOff?: boolean; idp?: TestIdp } = {}) {
  const idp = options.idp ?? (await createTestIdp());
  let now = NOW;
  const clock = { now: () => now };
  const conversations = new InMemoryConversationRepository();
  const handoffs = new InMemoryHandoffQueue();
  const log = new InMemoryConversationLog();
  const metricsStore = new InMemoryMetricsStore();
  const metrics = new MetricsRecorder(metricsStore, 'America/Sao_Paulo');
  const mediaNotes = new InMemoryMediaNotes();
  const thumbnailBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const thumbnails = { fetch: async (key: string) => (key === THUMBNAIL_KEY ? thumbnailBytes : null) };
  const published: OutboundMessage[] = [];
  const publisher: OutboundPublisher = { publish: async (messages) => void published.push(...messages) };
  const tools = new FakeSchedulingTools([{ session: aSession(), myBooking: { id: 'bk-1', status: 'confirmed' } }]);

  let result: AgentResult = { replies: [{ kind: 'text', text: 'Olá!' }], outcome: 'answered', citations: [] };
  const agent: ConversationAgent = {
    respond: async (conversation) => {
      if (result.outcome === 'handed_off') conversation.handOff('sensitive_topic', now);
      return result;
    },
  };
  const inbound = new HandleInboundMessage({ conversations, agent, publisher, outbox: conversations.outbox, handoffs, log, metrics, clock });
  if (options.handedOff) {
    result = { replies: [{ kind: 'text', text: 'Vou chamar alguém.' }], outcome: 'handed_off', citations: [] };
    await inbound.execute({ tenantId: TENANT, contactId: CONTACT, messageId: 'wamid.1', turn: { kind: 'text', text: 'estou com dor' } });
    published.length = 0;
    await mediaNotes.save(TENANT, 'wamid.1', { kind: 'image', status: 'processed', rejectionReason: null, transcribed: false, thumbnailKey: THUMBNAIL_KEY });
  }
  const app = buildPanelApi({
    verifier: createJwtVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: idp.keys }),
    internalToken: 'dev-only-internal-token',
    queries: new PanelQueries({ conversations, log, metrics: metricsStore, mediaNotes, thumbnails, clock, timezone: 'America/Sao_Paulo' }),
    reply: new ReplyAsAttendant({ conversations, publisher, outbox: conversations.outbox, log, metrics, clock }),
    resume: new ResumeConversation({ conversations, handoffs, publisher, outbox: conversations.outbox, log, metrics, clock }),
    notify: new NotifyStudent({ tools, conversations, publisher, log, metrics, ledger: new InMemoryNoticeLedger(), clock, timezone: 'America/Sao_Paulo' }),
    registry: createMetricsRegistry('test'),
  });
  const bearer = async (claims?: Parameters<TestIdp['token']>[0]) => ({ authorization: `Bearer ${await idp.token(claims)}` });
  const auth = await bearer({ roles: ['manager'] });
  return { app, auth, mediaNotes, thumbnailBytes, published, conversations, idp, bearer, advance: (ms: number) => void (now = new Date(now.getTime() + ms)), inbound };
}

