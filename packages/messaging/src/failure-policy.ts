// Decide o destino de uma mensagem que falhou. Função pura: testável sem broker.
import { ContractViolation } from '@wba/contracts';

/** Falha que não melhora com retry (payload inválido, recurso inexistente, erro 4xx definitivo). */
export class PermanentFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentFailure';
  }
}

export type FailureDecision = { readonly action: 'retry'; readonly nextAttempt: number } | { readonly action: 'dead_letter'; readonly reason: string };

export function decideOnFailure(error: unknown, attempt: number, maxAttempts: number): FailureDecision {
  if (error instanceof ContractViolation || error instanceof PermanentFailure) {
    return { action: 'dead_letter', reason: error.name };
  }
  if (attempt >= maxAttempts) return { action: 'dead_letter', reason: 'max_attempts' };
  return { action: 'retry', nextAttempt: attempt + 1 };
}
