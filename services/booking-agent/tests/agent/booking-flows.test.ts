import { describe, expect, it } from 'vitest';
import { OFFER_TTL_MS } from '../../src/domain/conversation.js';
import { aSession } from '../domain/fixtures.js';
import { allText, defaultListing, setup } from './harness.js';

const intro = { text: 'Aqui estão as aulas.', highlightedSessionIds: [] };

describe('agente: fluxos de reserva', () => {
  it('lista e reserva pelo botão sem nova chamada ao LLM', async () => {
    const t = setup({ llm: [intro] });
    await t.say('quais horários tem amanhã?');

    const result = await t.act({ kind: 'action', action: 'book', targetId: 'ses-hatha-1' });

    expect(t.tools.calls).toEqual(['listSessions 2026-03-03..2026-03-03', 'book ses-hatha-1']);
    expect(allText(result.replies[0]!)).toMatch(/está confirmada/);
    expect(t.llm.calls).toHaveLength(1);
  });

  it('não reserva aula que não foi oferecida nem oferta vencida', async () => {
    const t = setup({ llm: [intro] });
    await t.say('horários');

    const notOffered = await t.act({ kind: 'action', action: 'book', targetId: 'ses-outra' });
    t.advance(OFFER_TTL_MS + 1);
    const expired = await t.act({ kind: 'action', action: 'book', targetId: 'ses-hatha-1' });

    expect(allText(notOffered.replies[0]!)).toMatch(/expirou/);
    expect(allText(expired.replies[0]!)).toMatch(/expirou/);
    expect(t.tools.calls.filter((c) => c.startsWith('book'))).toEqual([]);
  });

  it('aula lotada vira oferta de lista de espera, com posição ao entrar', async () => {
    const t = setup({ llm: [intro] });
    await t.say('horários');

    const offer = await t.act({ kind: 'action', action: 'book', targetId: 'ses-pilates-1' });
    const joined = await t.act({ kind: 'action', action: 'waitlist', targetId: 'ses-pilates-1' });

    expect(offer.replies[0]).toMatchObject({ kind: 'choices', choices: [{ action: 'waitlist', targetId: 'ses-pilates-1' }] });
    expect(allText(joined.replies[0]!)).toBe('Você entrou na lista de espera de Pilates Solo (qua 04/03 07:00). Sua posição agora: 4.');
  });

  it('avisa quando a última vaga acabou entre a oferta e a reserva', async () => {
    const t = setup({ llm: [intro] });
    await t.say('horários');
    t.tools.bookStatus = 'waitlisted';

    const result = await t.act({ kind: 'action', action: 'book', targetId: 'ses-hatha-1' });

    expect(allText(result.replies[0]!)).toMatch(/acabou agora, então você entrou na lista de espera/);
  });

  it('cancelamento lista só reservas do aluno e cancela pela escolha', async () => {
    const listing = [...defaultListing(), { session: aSession({ id: 'ses-meu' }), myBooking: { id: 'bk-meu', status: 'confirmed' as const } }];
    const t = setup({ listing });

    const choices = await t.say('preciso cancelar minha aula');
    const done = await t.act({ kind: 'action', action: 'cancel', targetId: 'bk-meu' });

    expect(choices.replies[0]).toMatchObject({ kind: 'choices', choices: [{ action: 'cancel', targetId: 'bk-meu' }] });
    expect(t.tools.calls).toContain('cancel bk-meu');
    expect(allText(done.replies[0]!)).toMatch(/Reserva cancelada: Hatha Yoga/);
  });

  it('não cancela reserva que não foi mostrada ao aluno', async () => {
    const t = setup();

    const result = await t.act({ kind: 'action', action: 'cancel', targetId: 'bk-de-outra-pessoa' });

    expect(allText(result.replies[0]!)).toMatch(/expirou/);
    expect(t.tools.calls).toEqual([]);
  });

  it('sem aulas no período, responde sem chamar o LLM', async () => {
    const t = setup({ listing: [] });

    const result = await t.say('horários hoje');

    expect(allText(result.replies[0]!)).toMatch(/Não encontrei aulas/);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('aceita um JSON inválido do LLM e corrige no retry', async () => {
    const t = setup({ llm: ['```json\n{"intent": "list"}\n```', { intent: 'list_slots', sessionId: null, day: '2026-03-06' }, intro] });

    const result = await t.say('e pra sexta que vem, o que rola?');

    expect(result.outcome).toBe('answered');
    expect(t.tools.calls).toEqual(['listSessions 2026-03-06..2026-03-06']);
    expect(t.llm.calls).toHaveLength(3);
  });
});
