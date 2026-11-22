// Decide o destino de uma mensagem que falhou. Função pura: testável sem broker.
import { ContractViolation } from '@wba/contracts';

/** Falha que não melhora com retry (payload inválido, recurso inexistente, erro 4xx definitivo). */
export class PermanentFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentFailure';
  }
}

/**
 * Ocupação, não falha: o recurso está ocupado por outro trabalho (ex.: outra mensagem do mesmo aluno em
 * processamento). Volta pela fila de retry **sem gastar tentativa**, para uma rajada não esgotar as tentativas
 * e cair na DLQ sem defeito nenhum. O limite é a idade: passado `maxDeferMs`, vai para a DLQ.
 */
export class Deferred extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'Deferred';
  }
}

export const DEFAULT_MAX_DEFER_MS = 10 * 60 * 1000;

export interface DeferContext {
  /** Agora, em milissegundos. */
  readonly now: number;
  /** Quando a mensagem foi adiada pela primeira vez (header `x-deferred-since`), se já foi. */
  readonly deferredSince?: number | undefined;
  readonly maxDeferMs: number;
}

export type FailureDecision =
  | { readonly action: 'retry'; readonly nextAttempt: number; readonly deferredSince?: number }
  | { readonly action: 'dead_letter'; readonly reason: string };

export function decideOnFailure(error: unknown, attempt: number, maxAttempts: number, defer?: DeferContext): FailureDecision {
  if (error instanceof ContractViolation || error instanceof PermanentFailure) {
    return { action: 'dead_letter', reason: error.name };
  }
  if (error instanceof Deferred) {
    const context = defer ?? { now: Date.now(), maxDeferMs: DEFAULT_MAX_DEFER_MS };
    const since = context.deferredSince ?? context.now;
    if (context.now - since >= context.maxDeferMs) return { action: 'dead_letter', reason: 'deferred_too_long' };
    return { action: 'retry', nextAttempt: attempt, deferredSince: since };
  }
  if (attempt >= maxAttempts) return { action: 'dead_letter', reason: 'max_attempts' };
  return { action: 'retry', nextAttempt: attempt + 1 };
}
