import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import { unavailable } from '../support/fake-tools.js';
import { allText, setup } from './harness.js';

describe('agente: escopo e recusas', () => {
  it('recusa fora do escopo sem chamar LLM nem ferramentas', async () => {
    const t = setup();

    const result = await t.say('me conta uma piada');

    expect(result.outcome).toBe('refused');
    expect(allText(result.replies[0]!)).toMatch(/só consigo ajudar com aulas e reservas/);
    expect(t.llm.calls).toHaveLength(0);
    expect(t.tools.calls).toHaveLength(0);
  });

  it('o LLM decide o ambíguo e pode recusar', async () => {
    const t = setup({ llm: [{ intent: 'out_of_scope', sessionId: null, day: null }] });

    const result = await t.say('e sobre aquele assunto de ontem?');

    expect(result.outcome).toBe('refused');
    expect(t.llm.calls).toHaveLength(1);
  });

  it('recusa não conta como falha: o bot respondeu certo', async () => {
    const t = setup();
    await t.say('me conta uma piada');
    await t.say('escreve um poema');
    await t.say('quem ganha a eleição?');

    expect(t.conversation.isBotActive()).toBe(true);
  });

  it('saudação responde o menu sem LLM', async () => {
    const t = setup();

    const result = await t.say('Oi');

    expect(allText(result.replies[0]!)).toMatch(/horários das aulas/);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('mídia sem suporte recebe orientação', async () => {
    const t = setup();

    const result = await t.act({ kind: 'unsupported' });

    expect(allText(result.replies[0]!)).toMatch(/texto e de áudio/);
  });
});

describe('agente: transferência para humano', () => {
  it.each([
    ['pedido explícito', 'quero falar com uma pessoa real', 'explicit_request'],
    ['tema sensível', 'machuquei o ombro, posso ir na aula?', 'sensitive_topic'],
  ])('transfere por %s e o bot para de responder', async (_name, text, reason) => {
    const t = setup();

    const result = await t.say(text);

    expect(result.outcome).toBe('handed_off');
    expect(allText(result.replies[0]!)).toMatch(/alguém da equipe/);
    expect(t.conversation.status).toBe('handed_off');
    expect(t.conversation.snapshot().handoff?.reason).toBe(reason);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('o LLM também pode identificar pedido de humano', async () => {
    const t = setup({ llm: [{ intent: 'human', sessionId: null, day: null }] });

    const result = await t.say('dá pra alguém me ligar?');

    expect(result.outcome).toBe('handed_off');
  });

  it('transfere na segunda falha seguida de interpretação (LLM inválido mesmo após retry)', async () => {
    const t = setup({ llm: ['não sei', '{"intent": "dançar"}', 'texto solto', '{}'] });

    const first = await t.say('hmm, e aquela?');
    const second = await t.say('aquela lá');

    expect(first.outcome).toBe('failed');
    expect(allText(first.replies[0]!)).toMatch(/Não entendi/);
    expect(second.outcome).toBe('handed_off');
    expect(t.llm.calls).toHaveLength(4);
    expect(t.rejected).toEqual(['interpret', 'interpret']);
    expect(t.conversation.snapshot().handoff?.reason).toBe('repeated_failure');
  });

  it('agenda fora do ar duas vezes também transfere', async () => {
    const t = setup();
    t.tools.failWith = unavailable();

    const first = await t.say('quais horários tem?');
    const second = await t.say('quais horários tem?');

    expect(allText(first.replies[0]!)).toMatch(/indisponível/);
    expect(second.outcome).toBe('handed_off');
  });

  it('LLM fora do ar conta como falha e o aluno recebe resposta', async () => {
    const t = setup();

    const result = await t.say('hmm, e aquela?');

    expect(result.outcome).toBe('failed');
    expect(allText(result.replies[0]!)).toMatch(/indisponível/);
  });

  it('erro inesperado da ferramenta conta como falha, não como regra de negócio', async () => {
    const t = setup();
    t.tools.failWith = new Error('socket hang up');

    const result = await t.say('quais horários tem?');

    expect(result.outcome).toBe('failed');
  });

  it('recusa de regra do SaaS não conta como falha', async () => {
    const t = setup({ llm: [{ text: 'Separei estas aulas.', highlightedSessionIds: [] }] });
    await t.say('quais horários tem?');
    t.tools.failWith = new DomainError('overlapping_booking', 'conflito');

    const result = await t.act({ kind: 'action', action: 'book', targetId: 'ses-hatha-1' });

    expect(allText(result.replies[0]!)).toMatch(/outra aula nesse mesmo horário/);
    expect(t.conversation.consecutiveFailures).toBe(0);
  });
});
