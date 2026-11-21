// Prova por teste de que o bot só cita horários vindos das ferramentas.
import { describe, expect, it } from 'vitest';
import { temporalMentions, uncitedMentions } from '../../src/agent/citation-guard.js';
import { citableTokens } from '../../src/agent/format.js';
import type { Reply } from '../../src/application/ports.js';
import { Conversation } from '../../src/domain/conversation.js';
import { aSession, NOW } from '../domain/fixtures.js';
import { allText, defaultListing, setup } from './harness.js';

const toolTokens = new Set(
  defaultListing().flatMap(({ session }) => [
    ...citableTokens(session.startsAt.toISOString(), session.timezone),
    ...citableTokens(session.endsAt.toISOString(), session.timezone),
  ]),
);

function expectOnlyToolTimes(replies: readonly Reply[]) {
  const mentions = replies.flatMap((reply) => temporalMentions(allText(reply)));
  expect(mentions.length).toBeGreaterThan(0);
  for (const mention of mentions) expect(toolTokens).toContain(mention);
}

describe('agente: só cita horários das ferramentas', () => {
  it('usa a frase do LLM e renderiza os horários a partir das ferramentas', async () => {
    const t = setup({ llm: [{ text: 'Separei as aulas desta semana para você.', highlightedSessionIds: ['ses-pilates-1'] }] });

    const result = await t.say('quais horários tem?');

    const reply = result.replies[0]!;
    expect(reply.kind).toBe('choices');
    if (reply.kind !== 'choices') return;
    expect(reply.body).toBe('Separei as aulas desta semana para você.');
    expect(reply.choices.map((c) => c.targetId)).toEqual(['ses-pilates-1', 'ses-hatha-1']);
    expect(reply.choices[1]).toMatchObject({ action: 'book', description: 'ter 03/03 18:00 · com vaga' });
    expect(reply.choices[0]).toMatchObject({ action: 'waitlist' });
    expectOnlyToolTimes(result.replies);
  });

  it('rejeita horário inventado pelo LLM, faz um retry e cai no texto fixo', async () => {
    const t = setup({
      llm: [
        { text: 'Temos uma aula extra às 19h hoje!', highlightedSessionIds: [] },
        { text: 'Também tem aula 20:30 no dia 05/03.', highlightedSessionIds: [] },
      ],
    });

    const result = await t.say('quais horários tem?');

    expect(t.llm.calls).toHaveLength(2);
    expect(t.llm.calls[1]!.at(-1)!.content).toMatch(/não pode conter datas ou horários/);
    expect(t.rejected).toEqual(['compose']);
    const text = allText(result.replies[0]!);
    expect(text).not.toMatch(/19h|20:30|05\/03/);
    expect(text).toMatch(/Estas são as aulas que encontrei/);
    expectOnlyToolTimes(result.replies);
  });

  it('rejeita aula destacada que não veio das ferramentas', async () => {
    const t = setup({
      llm: [
        { text: 'Olha estas opções.', highlightedSessionIds: ['ses-inventada'] },
        { text: 'Olha estas opções.', highlightedSessionIds: [] },
      ],
    });

    const result = await t.say('quais horários tem?');

    expect(t.llm.calls[1]!.at(-1)!.content).toMatch(/ses-inventada não veio das ferramentas/);
    expect(allText(result.replies[0]!)).not.toMatch(/inventada/);
  });

  it('o LLM não consegue reservar aula que não foi oferecida', async () => {
    const t = setup({
      llm: [
        { text: 'Aqui estão.', highlightedSessionIds: [] },
        { intent: 'book', sessionId: 'ses-que-nao-existe', day: null },
        { intent: 'book', sessionId: 'ses-que-nao-existe', day: null },
      ],
    });
    await t.say('quais horários tem?');

    const result = await t.say('pode ser aquela das 6');

    expect(result.outcome).toBe('failed');
    expect(t.tools.calls.filter((c) => c.startsWith('book'))).toEqual([]);
  });

  it('confirmação de reserva cita o horário da oferta, não o que o aluno escreveu', async () => {
    const t = setup({
      llm: [
        { text: 'Aqui estão.', highlightedSessionIds: [] },
        { intent: 'book', sessionId: 'ses-hatha-1', day: null },
      ],
    });
    await t.say('quais horários tem?');

    const result = await t.say('pode ser aquela das 19h30');

    expect(t.tools.calls).toContain('book ses-hatha-1');
    expect(allText(result.replies[0]!)).toBe('Pronto! Sua vaga em Hatha Yoga (ter 03/03 18:00) está confirmada.');
    expectOnlyToolTimes(result.replies);
  });

  describe('varredura final (uncitedMentions)', () => {
    const conversation = Conversation.start({ tenantId: 't', contactId: 'c' });
    const [slot] = conversation.offerSlots([{ session: aSession({ title: 'Yoga 1h30 Intensivo' }), booking: null }], NOW);

    it('aceita horários e datas da oferta e ignora números do título', () => {
      const reply: Reply = { kind: 'text', text: 'Yoga 1h30 Intensivo, ter 03/03 18:00 até 19:00.' };

      expect(uncitedMentions(reply, [slot!])).toEqual([]);
    });

    it.each(['às 20h', 'às 7 da noite', 'no dia 04/03', 'ao meio-dia'])('aponta menção fora das ferramentas: "%s"', (text) => {
      expect(uncitedMentions({ kind: 'text', text }, [slot!])).not.toEqual([]);
    });
  });
});
