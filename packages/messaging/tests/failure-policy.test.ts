import { ContractViolation } from '@wba/contracts';
import { describe, expect, it } from 'vitest';
import { decideOnFailure, Deferred, PermanentFailure } from '../src/failure-policy.js';

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

describe('ocupação (Deferred) não é falha', () => {
  const NOW = 1_000_000;

  it('mais ocupações seguidas que o limite de tentativas não vão para a DLQ e não gastam tentativa', () => {
    let attempt = 1;
    let deferredSince: number | undefined;
    for (let busy = 0; busy < 50; busy++) {
      const decision = decideOnFailure(new Deferred('contato ocupado'), attempt, 4, { now: NOW + busy * 3000, deferredSince, maxDeferMs: 600_000 });
      expect(decision.action).toBe('retry');
      if (decision.action !== 'retry') return;
      attempt = decision.nextAttempt;
      deferredSince = decision.deferredSince;
    }
    expect(attempt).toBe(1);
    expect(deferredSince).toBe(NOW);
  });

  it('depois do limite de idade vai para a DLQ com motivo próprio', () => {
    expect(decideOnFailure(new Deferred('x'), 1, 4, { now: NOW + 600_000, deferredSince: NOW, maxDeferMs: 600_000 })).toEqual({ action: 'dead_letter', reason: 'deferred_too_long' });
    expect(decideOnFailure(new Deferred('x'), 1, 4, { now: NOW + 599_999, deferredSince: NOW, maxDeferMs: 600_000 }).action).toBe('retry');
  });

  it('a falha de verdade depois de adiamentos continua gastando tentativas', () => {
    expect(decideOnFailure(new Error('timeout'), 1, 4)).toEqual({ action: 'retry', nextAttempt: 2 });
    expect(decideOnFailure(new Error('timeout'), 4, 4)).toEqual({ action: 'dead_letter', reason: 'max_attempts' });
  });
});
