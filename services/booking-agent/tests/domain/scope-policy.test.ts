import { describe, expect, it } from 'vitest';
import { classifyScope } from '../../src/domain/scope-policy.js';

describe('política de escopo determinística', () => {
  it.each([
    ['Quero falar com um ATENDENTE', 'explicit_request'],
    ['posso falar com alguém da equipe?', 'explicit_request'],
    ['Estou com dor no joelho, posso fazer pilates amanhã?', 'sensitive_topic'],
    ['estou grávida de 3 meses', 'sensitive_topic'],
    ['fui cobrada duas vezes na mensalidade', 'sensitive_topic'],
  ])('transfere para humano: "%s"', (text, reason) => {
    expect(classifyScope(text)).toEqual({ kind: 'handoff', reason });
  });

  it('pedido de humano vence até tema fora do escopo', () => {
    expect(classifyScope('me passa uma receita ou chama uma pessoa real')).toEqual({ kind: 'handoff', reason: 'explicit_request' });
  });

  it('tema sensível vence intenção de reserva', () => {
    expect(classifyScope('quero reservar mas tenho hérnia de disco')).toEqual({ kind: 'handoff', reason: 'sensitive_topic' });
  });

  it.each(['me conta uma piada', 'escreve um código em Python', 'quem ganha a eleição?', 'qual a previsão do tempo?'])(
    'recusa fora do escopo: "%s"',
    (text) => {
      expect(classifyScope(text)).toEqual({ kind: 'out_of_scope' });
    },
  );

  it.each([
    ['Quais horários tem amanhã?', 'list_slots'],
    ['quero reservar o pilates', 'book'],
    ['preciso desmarcar minha aula', 'cancel'],
    ['me coloca na lista de espera', 'join_waitlist'],
    ['Oi!', 'greeting'],
    ['Bom dia', 'greeting'],
  ])('reconhece intenção explícita: "%s"', (text, intent) => {
    expect(classifyScope(text)).toEqual({ kind: 'in_scope', intent });
  });

  it.each(['', '   ', 'hmm, e aquela de quinta?', 'pode ser'])('deixa para o LLM o que é ambíguo: "%s"', (text) => {
    expect(classifyScope(text)).toEqual({ kind: 'undecided' });
  });

  it('ignora acentos e caixa', () => {
    expect(classifyScope('HORÁRIOS')).toEqual({ kind: 'in_scope', intent: 'list_slots' });
  });
});
