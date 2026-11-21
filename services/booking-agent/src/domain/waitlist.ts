// Lista de espera vista pelo contexto de Agendamento.
//
// O SaaS é dono da fila completa (quem está nela e em que ordem); ao aluno ele expõe só o
// tamanho da fila e a própria reserva. Este agregado modela exatamente o que o aluno pode
// saber: o tamanho e a posição dele no momento em que entrou (ver roteiro do modelo de domínio).
import type { ClassSession } from './class-session.js';
import { DomainError } from './errors.js';

export interface WaitlistJoin {
  readonly waitlist: Waitlist;
  /** Posição estimada (1 = próximo a ser promovido), válida no instante da entrada. */
  readonly position: number;
}

export class Waitlist {
  private constructor(
    readonly sessionId: string,
    readonly length: number,
    private readonly memberQueued: boolean,
  ) {}

  static of(session: ClassSession, memberQueued: boolean): Waitlist {
    return new Waitlist(session.id, session.waitlistCount, memberQueued);
  }

  includesMember(): boolean {
    return this.memberQueued;
  }

  /**
   * Regras para entrar: aula lotada e não começada, e o aluno ainda fora da fila.
   * A fila é FIFO, então quem entra fica atrás de todos que já estavam.
   */
  join(session: ClassSession, now: Date, memberHasSeat: boolean): WaitlistJoin {
    if (session.id !== this.sessionId) {
      throw new DomainError('invalid_request', 'A fila informada não é a desta aula.');
    }
    if (this.memberQueued) {
      throw new DomainError('already_in_waitlist', 'Você já está na lista de espera desta aula.');
    }
    if (memberHasSeat) {
      throw new DomainError('already_booked', 'Você já tem vaga nesta aula.');
    }
    session.assertWaitlistOpenAt(now);
    const waitlist = new Waitlist(this.sessionId, this.length + 1, true);
    return { waitlist, position: waitlist.length };
  }

  /** O primeiro da fila ocupa a vaga liberada; a fila encolhe e o aluno, se promovido, sai dela. */
  promoteNext(memberWasFirst: boolean): Waitlist {
    if (this.length === 0) {
      throw new DomainError('invalid_booking_transition', 'Fila vazia: não há quem promover.');
    }
    if (memberWasFirst && !this.memberQueued) {
      throw new DomainError('invalid_booking_transition', 'O aluno não estava na fila.');
    }
    return new Waitlist(this.sessionId, this.length - 1, this.memberQueued && !memberWasFirst);
  }
}
