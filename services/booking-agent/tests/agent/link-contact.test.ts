import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import { allText, setup } from './harness.js';

describe('agente: vínculo do telefone ao aluno', () => {
  it('"vincular 123456" confirma o código sem passar pelo LLM nem pela política de escopo', async () => {
    const t = setup();

    const result = await t.say('Vincular 123456');

    expect(t.tools.calls).toEqual(['linkContact 123456']);
    expect(t.llm.calls).toHaveLength(0);
    expect(allText(result.replies[0]!)).toMatch(/Pronto, Aluna Exemplo/);
    expect(result.outcome).toBe('answered');
  });

  it('código recusado pelo SaaS explica como gerar outro, sem contar como falha', async () => {
    const t = setup();
    t.tools.failWith = new DomainError('invalid_link_code', 'código inválido');

    const result = await t.say('vincular 000000');

    expect(allText(result.replies[0]!)).toMatch(/gere um novo/i);
    expect(result.outcome).toBe('answered');
    expect(t.conversation.consecutiveFailures).toBe(0);
  });

  it('telefone sem vínculo, ao pedir horários, recebe o passo a passo do opt-in', async () => {
    const t = setup({ llm: [] });
    t.tools.failWith = new DomainError('contact_not_linked', 'sem vínculo');

    const result = await t.say('quais horários tem amanhã?');

    expect(allText(result.replies[0]!)).toMatch(/vincular 123456/);
  });
});
