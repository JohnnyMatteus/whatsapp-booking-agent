import { ContractViolation } from '@wba/contracts';
import { describe, expect, it } from 'vitest';
import { decideOnFailure, PermanentFailure } from '../src/failure-policy.js';

describe('política de falha do consumidor', () => {
  it('falha transitória tenta de novo até o limite e depois vai para a DLQ', () => {
    expect(decideOnFailure(new Error('timeout'), 1, 5)).toEqual({ action: 'retry', nextAttempt: 2 });
    expect(decideOnFailure(new Error('timeout'), 5, 5)).toEqual({ action: 'dead_letter', reason: 'max_attempts' });
  });

  it('mensagem fora do contrato ou falha permanente vai direto para a DLQ', () => {
    expect(decideOnFailure(new ContractViolation(['type: inválido']), 1, 5)).toEqual({ action: 'dead_letter', reason: 'ContractViolation' });
    expect(decideOnFailure(new PermanentFailure('número inválido'), 1, 5)).toEqual({ action: 'dead_letter', reason: 'PermanentFailure' });
  });
});
