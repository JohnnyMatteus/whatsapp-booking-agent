import { createMetricsRegistry } from '@wba/observability';
import { describe, expect, it } from 'vitest';
import { buildPanelApi, maskContact } from '../../src/adapters/http/server.js';
import { InMemoryConversationRepository, InMemoryHandoffQueue } from '../../src/adapters/persistence/in-memory.js';
import { ResumeConversation } from '../../src/application/resume-conversation.js';
import { Conversation } from '../../src/domain/conversation.js';
import { NOW } from '../domain/fixtures.js';

async function setup() {
  const conversations = new InMemoryConversationRepository();
  const handoffs = new InMemoryHandoffQueue();
  const conversation = Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
  conversation.handOff('explicit_request', NOW);
  await conversations.save(conversation);
  await handoffs.enqueue({ tenantId: 'estudio-lotus', conversationId: conversation.id, contactId: '5511900000001', reason: 'explicit_request', requestedAt: NOW.toISOString() });
  const app = buildPanelApi({
    token: 'dev-only-panel-token',
    handoffs,
    resume: new ResumeConversation({ conversations, handoffs, clock: { now: () => NOW } }),
    registry: createMetricsRegistry('test'),
  });
  return { app, handoffs, conversations };
}

const auth = { authorization: 'Bearer dev-only-panel-token' };

describe('API do painel', () => {
  it('exige token', async () => {
    const { app } = await setup();

    expect((await app.inject({ url: '/api/tenants/estudio-lotus/handoffs' })).statusCode).toBe(401);
  });

  it('lista a fila com o contato mascarado', async () => {
    const { app } = await setup();

    const response = await app.inject({ url: '/api/tenants/estudio-lotus/handoffs', headers: auth });

    expect(response.json()).toEqual({
      data: [{ conversationId: 'estudio-lotus:5511900000001', contact: '*********0001', reason: 'explicit_request', requestedAt: NOW.toISOString() }],
    });
  });

  it('devolve a conversa ao bot e tira da fila; estúdio errado não enxerga o ticket', async () => {
    const { app, conversations } = await setup();

    const otherTenant = await app.inject({ method: 'POST', url: '/api/tenants/outro-estudio/handoffs/estudio-lotus:5511900000001/resume', headers: auth });
    const resumed = await app.inject({ method: 'POST', url: '/api/tenants/estudio-lotus/handoffs/estudio-lotus:5511900000001/resume', headers: auth });

    expect(otherTenant.statusCode).toBe(404);
    expect(resumed.statusCode).toBe(204);
    expect((await conversations.load('estudio-lotus', '5511900000001'))?.isBotActive()).toBe(true);
  });

  it('mascara contatos curtos por inteiro', () => {
    expect(maskContact('123')).toBe('****');
  });
});
