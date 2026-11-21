// Aula: uma ocorrência da grade do estúdio, como o aluno a enxerga no WhatsApp.
import { DomainError } from './errors.js';

export interface ClassSessionProps {
  readonly id: string;
  readonly title: string;
  readonly instructorName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Fuso IANA do estúdio; a apresentação de horários sempre usa este fuso. */
  readonly timezone: string;
  readonly capacity: number;
  readonly confirmedCount: number;
  readonly waitlistCount: number;
}

export type BookingOutcome = 'seat' | 'waitlist';

export class ClassSession {
  private constructor(private readonly props: ClassSessionProps) {}

  static create(props: ClassSessionProps): ClassSession {
    const problems: string[] = [];
    if (props.id.trim() === '') problems.push('id vazio');
    if (props.title.trim() === '') problems.push('título vazio');
    if (Number.isNaN(props.startsAt.getTime()) || Number.isNaN(props.endsAt.getTime())) problems.push('horário inválido');
    else if (props.endsAt.getTime() <= props.startsAt.getTime()) problems.push('termina antes de começar');
    if (!isValidTimezone(props.timezone)) problems.push(`fuso desconhecido: ${props.timezone}`);
    if (!Number.isInteger(props.capacity) || props.capacity < 1) problems.push('capacidade deve ser inteiro positivo');
    if (!Number.isInteger(props.confirmedCount) || props.confirmedCount < 0) problems.push('confirmados negativo');
    else if (props.confirmedCount > props.capacity) problems.push('mais confirmados que a capacidade');
    if (!Number.isInteger(props.waitlistCount) || props.waitlistCount < 0) problems.push('fila negativa');
    if (props.waitlistCount > 0 && props.confirmedCount < props.capacity) problems.push('fila com vaga sobrando');

    if (problems.length > 0) {
      throw new DomainError('invalid_class_session', `Aula inválida: ${problems.join(', ')}.`);
    }
    return new ClassSession({ ...props, startsAt: new Date(props.startsAt), endsAt: new Date(props.endsAt) });
  }

  get id(): string {
    return this.props.id;
  }
  get title(): string {
    return this.props.title;
  }
  get instructorName(): string {
    return this.props.instructorName;
  }
  get startsAt(): Date {
    return new Date(this.props.startsAt);
  }
  get endsAt(): Date {
    return new Date(this.props.endsAt);
  }
  get timezone(): string {
    return this.props.timezone;
  }
  get capacity(): number {
    return this.props.capacity;
  }
  get waitlistCount(): number {
    return this.props.waitlistCount;
  }

  availableSpots(): number {
    return this.props.capacity - this.props.confirmedCount;
  }

  isFull(): boolean {
    return this.availableSpots() === 0;
  }

  /** Começou = não aceita reserva, cancelamento nem fila (mesma regra do SaaS). */
  hasStartedAt(now: Date): boolean {
    return now.getTime() >= this.props.startsAt.getTime();
  }

  /** O que uma nova reserva receberia agora. Aula começada não recebe nada. */
  bookingOutcomeAt(now: Date): BookingOutcome {
    this.assertNotStarted(now);
    return this.isFull() ? 'waitlist' : 'seat';
  }

  /** Lista de espera só faz sentido em aula lotada: com vaga, o certo é reservar. */
  assertWaitlistOpenAt(now: Date): void {
    this.assertNotStarted(now);
    if (!this.isFull()) {
      throw new DomainError('seats_available', 'A aula ainda tem vaga; faça a reserva direto.');
    }
  }

  toProps(): ClassSessionProps {
    return { ...this.props, startsAt: this.startsAt, endsAt: this.endsAt };
  }

  private assertNotStarted(now: Date): void {
    if (this.hasStartedAt(now)) {
      throw new DomainError('class_session_started', 'A aula já começou.');
    }
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
