// Conversa: o agregado que decide se o bot pode falar, o que ele já ofereceu ao aluno e quando
// a conversa sai do bot e vai para um humano.
import { ClassSession } from './class-session.js';
import { DomainError } from './errors.js';
import type { ConversationEvent, HandoffReason } from './events.js';

export type ConversationStatus = 'bot_active' | 'handed_off';

export interface SlotOffer {
  readonly session: ClassSession;
  readonly booking: OfferedSlot['booking'];
}

/** Resultado de receber uma mensagem: processar, ignorar repetida ou guardar sem responder. */
export type ReceiveOutcome = 'process' | 'duplicate' | 'silenced';

/** Fotografia de uma aula oferecida ao aluno: a única fonte de horários que o bot pode citar. */
export interface OfferedSlot {
  readonly sessionId: string;
  readonly title: string;
  readonly instructorName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly capacity: number;
  readonly confirmedCount: number;
  readonly waitlistCount: number;
  /** Reserva ativa do aluno nesta aula, quando houver (permite oferecer o cancelamento). */
  readonly booking: { readonly id: string; readonly status: 'confirmed' | 'waitlisted' } | null;
}

/** Reconstrói a Aula a partir da oferta, revalidando as invariantes. */
export function sessionOf(slot: OfferedSlot): ClassSession {
  return ClassSession.create({
    id: slot.sessionId,
    title: slot.title,
    instructorName: slot.instructorName,
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt),
    timezone: slot.timezone,
    capacity: slot.capacity,
    confirmedCount: slot.confirmedCount,
    waitlistCount: slot.waitlistCount,
  });
}

export interface ConversationSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly status: ConversationStatus;
  readonly consecutiveFailures: number;
  readonly processedMessageIds: readonly string[];
  readonly offeredSlots: readonly OfferedSlot[];
  readonly offeredAt: string | null;
  readonly handoff: { readonly reason: HandoffReason; readonly at: string } | null;
  /** Controle de concorrência otimista no repositório. */
  readonly version: number;
}

export const MAX_CONSECUTIVE_FAILURES = 2;
/** Uma oferta velha pode mostrar vaga que já acabou: depois disso o aluno precisa listar de novo. */
export const OFFER_TTL_MS = 30 * 60 * 1000;
/** Janela de deduplicação local; a deduplicação principal é no gateway (ADR 0005). */
const PROCESSED_IDS_LIMIT = 50;

export class Conversation {
  private events: ConversationEvent[] = [];

  private constructor(private state: ConversationSnapshot) {}

  static start(params: { tenantId: string; contactId: string }): Conversation {
    if (params.tenantId.trim() === '' || params.contactId.trim() === '') {
      throw new DomainError('invalid_request', 'Conversa precisa de estúdio e contato.');
    }
    return new Conversation({
      id: `${params.tenantId}:${params.contactId}`,
      tenantId: params.tenantId,
      contactId: params.contactId,
      status: 'bot_active',
      consecutiveFailures: 0,
      processedMessageIds: [],
      offeredSlots: [],
      offeredAt: null,
      handoff: null,
      version: 0,
    });
  }

  static restore(snapshot: ConversationSnapshot): Conversation {
    return new Conversation(structuredClone(snapshot) as ConversationSnapshot);
  }

  get id(): string {
    return this.state.id;
  }
  get tenantId(): string {
    return this.state.tenantId;
  }
  get contactId(): string {
    return this.state.contactId;
  }
  get status(): ConversationStatus {
    return this.state.status;
  }
  get consecutiveFailures(): number {
    return this.state.consecutiveFailures;
  }

  isBotActive(): boolean {
    return this.state.status === 'bot_active';
  }

  /**
   * Toda mensagem passa por aqui, inclusive as que chegam com a conversa transferida:
   * o id fica registrado (deduplicação) mas o bot não responde.
   */
  receive(messageId: string): ReceiveOutcome {
    if (this.state.processedMessageIds.includes(messageId)) return 'duplicate';
    this.state = {
      ...this.state,
      processedMessageIds: [...this.state.processedMessageIds, messageId].slice(-PROCESSED_IDS_LIMIT),
    };
    return this.isBotActive() ? 'process' : 'silenced';
  }

  /** Substitui a oferta anterior: o aluno só escolhe entre o que viu por último. */
  offerSlots(offers: readonly SlotOffer[], now: Date): readonly OfferedSlot[] {
    this.assertBotActive();
    const slots = offers.map(({ session, booking }): OfferedSlot => {
      const props = session.toProps();
      return {
        sessionId: props.id,
        title: props.title,
        instructorName: props.instructorName,
        startsAt: props.startsAt.toISOString(),
        endsAt: props.endsAt.toISOString(),
        timezone: props.timezone,
        capacity: props.capacity,
        confirmedCount: props.confirmedCount,
        waitlistCount: props.waitlistCount,
        booking,
      };
    });
    this.state = { ...this.state, offeredSlots: slots, offeredAt: now.toISOString() };
    return slots;
  }

  /** Garante que a aula escolhida foi oferecida nesta conversa e que a oferta ainda vale. */
  offeredSlot(sessionId: string, now: Date): OfferedSlot {
    const slot = this.currentOffer(now).find((s) => s.sessionId === sessionId);
    if (!slot) throw new DomainError('slot_not_offered', 'Esse horário não está entre as opções que enviei.');
    return slot;
  }

  /** Cancelamento só de reserva que o próprio aluno viu na última oferta. */
  offeredBooking(bookingId: string, now: Date): OfferedSlot {
    const slot = this.currentOffer(now).find((s) => s.booking?.id === bookingId);
    if (!slot) throw new DomainError('slot_not_offered', 'Essa reserva não está entre as opções que enviei.');
    return slot;
  }

  currentOffer(now: Date): readonly OfferedSlot[] {
    const { offeredAt, offeredSlots } = this.state;
    if (offeredAt === null || now.getTime() - Date.parse(offeredAt) > OFFER_TTL_MS) return [];
    return offeredSlots;
  }

  recordSuccess(): void {
    this.state = { ...this.state, consecutiveFailures: 0 };
  }

  /**
   * Falha do bot (não entendeu, LLM inválido, agenda fora do ar). Recusa de regra de negócio
   * não conta: o bot respondeu certo. Na falha N seguida, a conversa vai para um humano.
   */
  recordFailure(now: Date): 'retry' | 'handed_off' {
    this.assertBotActive();
    const failures = this.state.consecutiveFailures + 1;
    this.state = { ...this.state, consecutiveFailures: failures };
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      this.handOff('repeated_failure', now);
      return 'handed_off';
    }
    return 'retry';
  }

  /** Idempotente: pedir transferência de novo não gera outro evento. */
  handOff(reason: HandoffReason, now: Date): void {
    if (this.state.status === 'handed_off') return;
    this.state = {
      ...this.state,
      status: 'handed_off',
      offeredSlots: [],
      offeredAt: null,
      handoff: { reason, at: now.toISOString() },
    };
    this.events.push({ type: 'handoff_requested', conversationId: this.state.id, reason, at: now });
  }

  /** O atendente devolve a conversa ao bot; o contador de falhas recomeça. */
  resumeBot(now: Date): void {
    if (this.state.status !== 'handed_off') {
      throw new DomainError('invalid_request', 'A conversa já está com o bot.');
    }
    this.state = { ...this.state, status: 'bot_active', consecutiveFailures: 0, handoff: null };
    this.events.push({ type: 'bot_resumed', conversationId: this.state.id, at: now });
  }

  /** Eventos ainda não publicados; esvazia a lista. */
  pullEvents(): ConversationEvent[] {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  snapshot(): ConversationSnapshot {
    return structuredClone(this.state) as ConversationSnapshot;
  }

  private assertBotActive(): void {
    if (!this.isBotActive()) {
      throw new DomainError('conversation_handed_off', 'A conversa está com um atendente; o bot não responde.');
    }
  }
}
