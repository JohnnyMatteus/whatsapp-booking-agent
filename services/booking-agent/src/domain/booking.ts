// Reserva: o lugar do aluno numa aula (vaga confirmada ou posição na fila).
import type { ClassSession } from './class-session.js';
import { DomainError } from './errors.js';

export type BookingStatus = 'confirmed' | 'waitlisted' | 'canceled';

export interface BookingProps {
  readonly id: string;
  readonly sessionId: string;
  readonly status: BookingStatus;
}

export interface Cancellation {
  readonly booking: Booking;
  /** Cancelar uma vaga confirmada libera lugar para o primeiro da fila. */
  readonly freedSeat: boolean;
}

export class Booking {
  private constructor(private readonly props: BookingProps) {}

  static create(props: BookingProps): Booking {
    if (props.id.trim() === '' || props.sessionId.trim() === '') {
      throw new DomainError('invalid_request', 'Reserva precisa de id e de aula.');
    }
    return new Booking({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get sessionId(): string {
    return this.props.sessionId;
  }
  get status(): BookingStatus {
    return this.props.status;
  }

  isActive(): boolean {
    return this.props.status !== 'canceled';
  }

  /**
   * Valida o cancelamento antes de chamar o SaaS. A janela de cancelamento é configurada por
   * estúdio e só o SaaS a conhece: ela volta como `cancellation_window_closed` pela ACL.
   */
  cancel(session: ClassSession, now: Date): Cancellation {
    if (session.id !== this.props.sessionId) {
      throw new DomainError('invalid_request', 'A aula informada não é a desta reserva.');
    }
    if (this.props.status === 'canceled') {
      throw new DomainError('booking_already_canceled', 'Esta reserva já foi cancelada.');
    }
    if (session.hasStartedAt(now)) {
      throw new DomainError('class_session_started', 'A aula já começou.');
    }
    return {
      booking: new Booking({ ...this.props, status: 'canceled' }),
      freedSeat: this.props.status === 'confirmed',
    };
  }

  /** Só quem está na fila pode ser promovido; confirmada e cancelada são estados finais para isso. */
  promote(): Booking {
    if (this.props.status !== 'waitlisted') {
      throw new DomainError('invalid_booking_transition', `Não é possível promover uma reserva ${this.props.status}.`);
    }
    return new Booking({ ...this.props, status: 'confirmed' });
  }

  toProps(): BookingProps {
    return { ...this.props };
  }
}
