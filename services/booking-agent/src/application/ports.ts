// Portas da camada de aplicação. Os adaptadores (MCP, RabbitMQ, Redis, LangGraph) implementam
// estas interfaces; os casos de uso não conhecem nenhum deles.
import type { Booking } from '../domain/booking.js';
import type { ClassSession } from '../domain/class-session.js';
import type { Conversation } from '../domain/conversation.js';
import type { HandoffReason } from '../domain/events.js';

/** Quem pede: o estúdio e o contato. A identidade no SaaS é resolvida do outro lado da porta. */
export interface MemberContext {
  readonly tenantId: string;
  readonly contactId: string;
}

/** Intervalo de datas locais do estúdio (YYYY-MM-DD, inclusivo), como o SaaS espera. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface SessionListing {
  readonly session: ClassSession;
  readonly myBooking: { readonly id: string; readonly status: 'confirmed' | 'waitlisted' } | null;
}

export interface CancellationOutcome {
  readonly booking: Booking;
  /** O SaaS promoveu alguém da fila para a vaga liberada. */
  readonly waitlistPromoted: boolean;
}

/**
 * Agenda do estúdio, vista pelo contexto de Agendamento. O adaptador fala com o servidor MCP;
 * erros do SaaS chegam aqui já como `DomainError` (ACL, ADR 0002).
 */
export interface SchedulingTools {
  listSessions(member: MemberContext, range: DateRange): Promise<readonly SessionListing[]>;
  book(member: MemberContext, sessionId: string): Promise<Booking>;
  cancel(member: MemberContext, bookingId: string): Promise<CancellationOutcome>;
  joinWaitlist(member: MemberContext, sessionId: string): Promise<Booking>;
}

export type Turn =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'action'; readonly action: 'book' | 'cancel' | 'waitlist'; readonly targetId: string }
  | { readonly kind: 'unsupported' };

export interface InboundCommand extends MemberContext {
  readonly messageId: string;
  readonly turn: Turn;
}

export interface Choice {
  readonly action: 'book' | 'waitlist' | 'cancel';
  readonly targetId: string;
  readonly title: string;
  readonly description?: string;
}

/** Resposta neutra: o tradutor do sender decide o formato da Cloud API. */
export type Reply = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'choices'; readonly body: string; readonly choices: readonly Choice[] };

export type TurnOutcome = 'answered' | 'refused' | 'handed_off' | 'failed';

export interface AgentResult {
  readonly replies: readonly Reply[];
  readonly outcome: TurnOutcome;
}

/** O agente é um adaptador de aplicação: recebe a conversa e o turno e decide a resposta. */
export interface ConversationAgent {
  respond(conversation: Conversation, turn: Turn): Promise<AgentResult>;
}

export class ConcurrentModification extends Error {
  constructor(conversationId: string) {
    super(`Conversa ${conversationId} foi alterada por outro consumidor.`);
    this.name = 'ConcurrentModification';
  }
}

export interface ConversationRepository {
  load(tenantId: string, contactId: string): Promise<Conversation | null>;
  /** Salva se a versão persistida ainda for a que foi carregada; senão lança ConcurrentModification. */
  save(conversation: Conversation): Promise<void>;
}

export interface HandoffTicket {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly reason: HandoffReason;
  readonly requestedAt: string;
}

/** Fila de atendimento humano (modelo de leitura do painel). */
export interface HandoffQueue {
  enqueue(ticket: HandoffTicket): Promise<void>;
  list(tenantId: string): Promise<readonly HandoffTicket[]>;
  remove(tenantId: string, conversationId: string): Promise<void>;
}

export type OutboundMessage =
  | { readonly kind: 'reply'; readonly member: MemberContext; readonly inReplyTo: string; readonly reply: Reply }
  | { readonly kind: 'handoff'; readonly ticket: HandoffTicket };

export interface OutboundPublisher {
  publish(messages: readonly OutboundMessage[], correlationId: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
