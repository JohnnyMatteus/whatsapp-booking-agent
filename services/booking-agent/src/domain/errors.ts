// Erros de domínio do contexto de Agendamento. O `code` é estável: o agente escolhe a resposta
// ao aluno por ele, nunca pelo texto da mensagem.

export type DomainErrorCode =
  | 'invalid_class_session'
  | 'class_session_started'
  | 'class_session_full'
  | 'seats_available'
  | 'already_booked'
  | 'overlapping_booking'
  | 'booking_already_canceled'
  | 'invalid_booking_transition'
  | 'cancellation_window_closed'
  | 'already_in_waitlist'
  | 'slot_not_offered'
  | 'conversation_handed_off'
  | 'not_found'
  | 'access_denied'
  | 'invalid_request'
  | 'scheduling_unavailable';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** Verdadeiro só para falhas transitórias do sistema de agenda (vale tentar de novo). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(error: unknown, code?: DomainErrorCode): error is DomainError {
  return error instanceof DomainError && (code === undefined || error.code === code);
}
