import { describe, expect, it } from 'vitest';
import { maskContact } from '../../src/adapters/http/server.js';
import { CONTACT, CONVERSATION, internal, setup, TENANT } from '../support/panel-harness.js';
import { NOW } from '../domain/fixtures.js';

describe('API do painel', () => {
  it('exige token no painel e na rota interna', async () => {
    const { app, auth } = await setup();

    expect((await app.inject({ url: `/api/tenants/${TENANT}/conversations` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/internal/tenants/${TENANT}/notifications`, headers: auth, payload: {} })).statusCode).toBe(401);
  });

  it.each([
    ['GET', '/api/tenants/T/conversations'],
    ['GET', '/api/tenants/T/conversations/:c'],
    ['POST', '/api/tenants/T/conversations/:c/messages'],
    ['POST', '/api/tenants/T/conversations/:c/resume'],
    ['GET', '/api/tenants/T/metrics'],
    ['GET', '/api/tenants/T/scope'],
    ['POST', '/internal/tenants/T/notifications'],
  ] as const)('%s %s com o caminho codificado também exige token', async (method, template) => {
    const { app, published } = await setup({ handedOff: true });
    const path = template.replace('/T/', `/${TENANT}/`).replace('/:c', `/${CONVERSATION}`);
    const encoded = path.replace('/api/', '/%61pi/').replace('/internal/', '/%69nternal/');

    for (const url of [path, encoded]) {
      const payload = method === 'POST' ? { text: 'oi', contactId: CONTACT, kind: 'reminder', sessionId: 'ses-hatha-1', date: '2026-03-03' } : undefined;
      expect((await app.inject({ method, url, ...(payload ? { payload } : {}) })).statusCode, url).toBe(401);
    }
    expect(published).toEqual([]);
  });

  it('só saúde e métricas do Prometheus são públicas; caminho sem rota dá 404', async () => {
    const { app } = await setup();

    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/nao-existe' })).statusCode).toBe(404);
  });

  it('lista a fila com transferidas primeiro, contato mascarado e contadores', async () => {
    const { app, auth } = await setup({ handedOff: true });

    const response = await app.inject({ url: `/api/tenants/${TENANT}/conversations`, headers: auth });

    expect(response.json()).toMatchObject({
      meta: { waiting: 1, botActive: 0 },
      data: [{ conversationId: `${TENANT}:${CONTACT}`, contact: '*********0001', status: 'handed_off', handoff: { reason: 'sensitive_topic' }, lastMessage: { author: 'bot' } }],
    });
    // O id da conversa (`estúdio:contato`) é o que o contrato usa nas URLs; fora dele o telefone não aparece.
    expect(JSON.stringify(response.json()).replaceAll(`${TENANT}:${CONTACT}`, '')).not.toContain(CONTACT);
  });

  it('detalhe traz a linha do tempo com a costura e a janela de 24 h', async () => {
    const { app, auth } = await setup({ handedOff: true });

    const body = (await app.inject({ url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}`, headers: auth })).json();

    expect(body.timeline.map((e: { kind: string }) => e.kind)).toEqual(['student', 'bot', 'handoff']);
    expect(body.correlationId).toBe('wamid.1');
    expect(body.serviceWindowEndsAt).toBe(new Date(NOW.getTime() + 24 * 3600_000).toISOString());
    expect(body.context.linked).toBeNull();
  });

  it('conversa de outro estúdio, pedida por quem é do outro estúdio, recebe 404', async () => {
    const { app, bearer } = await setup({ handedOff: true });

    const response = await app.inject({ url: `/api/tenants/estudio-sol/conversations/${CONVERSATION}`, headers: await bearer({ tenant: 'estudio-sol' }) });

    expect(response.statusCode).toBe(404);
  });

  it('o atendente responde (202), a resposta sai pela fila e a espera entra nas métricas', async () => {
    const { app, auth, published, advance } = await setup({ handedOff: true });
    advance(4 * 60_000);

    const sent = await app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/messages`, headers: auth, payload: { text: 'Oi! Aqui é a recepção.' } });
    const metrics = (await app.inject({ url: `/api/tenants/${TENANT}/metrics?days=1`, headers: auth })).json();

    expect(sent.statusCode).toBe(202);
    expect(sent.json().entry).toMatchObject({ kind: 'attendant', text: 'Oi! Aqui é a recepção.' });
    expect(published).toEqual([expect.objectContaining({ kind: 'reply', reply: { kind: 'text', text: 'Oi! Aqui é a recepção.' } })]);
    expect(metrics).toMatchObject({ avgWaitSeconds: 240, totals: { handedOff: 1 }, handoffsByReason: { sensitive_topic: 1 } });
  });

  it('recusa resposta com a conversa no bot (409) e fora da janela de 24 h (409)', async () => {
    const withBot = await setup();
    await withBot.inbound.execute({ tenantId: TENANT, contactId: CONTACT, messageId: 'wamid.1', turn: { kind: 'text', text: 'oi' } });
    const early = await withBot.app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/messages`, headers: withBot.auth, payload: { text: 'oi' } });

    const late = await setup({ handedOff: true });
    late.advance(25 * 3600_000);
    const closed = await late.app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/messages`, headers: late.auth, payload: { text: 'oi' } });
    const empty = await late.app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/messages`, headers: late.auth, payload: { text: '  ' } });

    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('conversation_with_bot');
    expect(closed.json()).toMatchObject({ code: 'customer_service_window_closed' });
    expect(empty.statusCode).toBe(400);
  });

  it('devolve ao bot: 204, aviso ao aluno e costura "resumed"; repetir dá 409', async () => {
    const { app, auth, published } = await setup({ handedOff: true });

    const resumed = await app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/resume`, headers: auth });
    const again = await app.inject({ method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/resume`, headers: auth });
    const detail = (await app.inject({ url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}`, headers: auth })).json();

    expect(resumed.statusCode).toBe(204);
    expect(published).toHaveLength(1);
    expect(again.statusCode).toBe(409);
    expect(detail.status).toBe('bot_active');
    expect(detail.timeline.at(-1).kind).toBe('resumed');
  });

  it('envia o template de lembrete uma única vez, confirmando a reserva na agenda', async () => {
    const { app, auth, published } = await setup();
    const payload = { contactId: CONTACT, kind: 'reminder', sessionId: 'ses-hatha-1', date: '2026-03-03' };

    const first = await app.inject({ method: 'POST', url: `/internal/tenants/${TENANT}/notifications`, headers: internal, payload });
    const second = await app.inject({ method: 'POST', url: `/internal/tenants/${TENANT}/notifications`, headers: internal, payload });
    const detail = (await app.inject({ url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}`, headers: auth })).json();
    const metrics = (await app.inject({ url: `/api/tenants/${TENANT}/metrics?days=1`, headers: auth })).json();

    expect(first.statusCode).toBe(202);
    expect(second.json()).toEqual({ result: 'already_sent' });
    expect(published).toEqual([expect.objectContaining({ reply: { kind: 'template', template: 'lembrete_aula', params: ['Hatha Yoga', 'ter 03/03 18:00'] } })]);
    expect(detail.timeline[0]).toMatchObject({ kind: 'template', template: 'lembrete_aula', citations: [{ sessionId: 'ses-hatha-1', tool: 'listar_horarios' }] });
    expect(metrics.proactive).toEqual({ reminders: 1, waitlistPromotions: 0 });
  });

  it('não avisa quem não tem reserva confirmada na aula', async () => {
    const { app, published } = await setup();

    const response = await app.inject({ method: 'POST', url: `/internal/tenants/${TENANT}/notifications`, headers: internal, payload: { contactId: CONTACT, kind: 'promotion', sessionId: 'outra', date: '2026-03-03' } });

    expect(response.statusCode).toBe(404);
    expect(published).toEqual([]);
  });

  it('política de escopo e máscara', async () => {
    const { app, auth } = await setup();

    const scope = (await app.inject({ url: `/api/tenants/${TENANT}/scope`, headers: auth })).json();

    expect(scope.intents.length).toBeGreaterThan(0);
    expect(scope.refusal).toMatch(/aulas e reservas/);
    expect(maskContact('123')).toBe('****');
  });
});
