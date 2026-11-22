// Portas da camada de aplicação. Os adaptadores (MCP, RabbitMQ, Redis, LangGraph) implementam
// estas interfaces; os casos de uso não conhecem nenhum deles.
import type { Booking } from '../domain/booking.js';
import type { ClassSession } from '../domain/class-session.js';
import type { Conversation, OfferedSlot } from '../domain/conversation.js';
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
  /** Opt-in: confirma o código gerado pelo aluno no SaaS para o telefone que o enviou. */
  linkContact(member: MemberContext, code: string): Promise<{ readonly name: string }>;
}

export type Turn =
  | { readonly kind: 'text'; readonly text: string; readonly transcribed?: boolean }
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
export type Reply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'choices'; readonly body: string; readonly choices: readonly Choice[] }
  | { readonly kind: 'template'; readonly template: 'lembrete_aula' | 'vaga_liberada'; readonly params: readonly string[] };

export type TurnOutcome = 'answered' | 'refused' | 'handed_off' | 'failed';

export interface AgentResult {
  readonly replies: readonly Reply[];
  readonly outcome: TurnOutcome;
  /** Aulas que as respostas citam, todas vindas das ferramentas neste turno ou na oferta vigente. */
  readonly citations: readonly OfferedSlot[];
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

/** O que o media-processor concluiu sobre uma mídia do aluno (evento `media.processed`). */
export interface MediaNote {
  readonly kind: 'audio' | 'image';
  readonly status: 'processed' | 'rejected';
  readonly rejectionReason: string | null;
  readonly transcribed: boolean;
  /** Chave no armazenamento; fica no servidor, o painel só recebe se existe miniatura. */
  readonly thumbnailKey: string | null;
}

/** Anotações de mídia por mensagem, independentes da ordem em que o evento e o texto chegam. */
export interface MediaNotes {
  save(tenantId: string, messageId: string, note: MediaNote): Promise<void>;
  find(tenantId: string, messageId: string): Promise<MediaNote | null>;
  /** Só as mensagens que têm anotação; uma ida ao armazenamento para a linha do tempo inteira. */
  findMany(tenantId: string, messageIds: readonly string[]): Promise<ReadonlyMap<string, MediaNote>>;
}

/** Miniaturas guardadas pelo media-processor (baixadas pela API interna dele). */
export interface ThumbnailSource {
  /** null se a miniatura não existe mais (expirou no bucket). */
  fetch(key: string): Promise<Uint8Array | null>;
}

/** Fila de atendimento humano (modelo de leitura do painel). */
export interface HandoffQueue {
  enqueue(ticket: HandoffTicket): Promise<void>;
  list(tenantId: string): Promise<readonly HandoffTicket[]>;
  remove(tenantId: string, conversationId: string): Promise<void>;
}

export type OutboundMessage =
  | { readonly kind: 'reply'; readonly member: MemberContext; readonly inReplyTo?: string; readonly reply: Reply }
  | { readonly kind: 'handoff'; readonly ticket: HandoffTicket };

export interface OutboundPublisher {
  publish(messages: readonly OutboundMessage[], correlationId: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

/** O carimbo de fonte: o que o bot citou veio desta consulta à agenda. */
export interface SlotCitation {
  readonly sessionId: string;
  readonly title: string;
  readonly instructorName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly capacity: number;
  readonly confirmedCount: number;
  readonly waitlistCount: number;
  readonly fetchedAt: string;
  readonly tool: 'listar_horarios';
}

/** Visão da mídia para o painel: sem a chave do armazenamento. */
export interface MediaView {
  readonly kind: 'audio' | 'image';
  readonly status: 'processed' | 'rejected';
  readonly rejectionReason: string | null;
  readonly hasThumbnail: boolean;
}

export type TemplateName = 'lembrete_aula' | 'vaga_liberada';

interface EntryBase {
  readonly id: string;
  readonly at: string;
}

export type TimelineEntry =
  | (EntryBase & {
      readonly kind: 'student';
      readonly text: string;
      readonly transcribed: boolean;
      readonly messageId: string;
      readonly action: { readonly action: 'book' | 'cancel' | 'waitlist'; readonly targetId: string } | null;
      /** Preenchido só na leitura do painel, a partir do evento `media.processed`. */
      readonly media?: MediaView | null;
    })
  | (EntryBase & {
      readonly kind: 'bot';
      readonly text: string;
      readonly choices: readonly Choice[];
      readonly citations: readonly SlotCitation[];
      readonly outcome: TurnOutcome;
    })
  | (EntryBase & { readonly kind: 'attendant'; readonly text: string })
  | (EntryBase & { readonly kind: 'handoff'; readonly reason: HandoffReason })
  | (EntryBase & { readonly kind: 'resumed' })
  | (EntryBase & { readonly kind: 'template'; readonly template: TemplateName; readonly text: string; readonly citations: readonly SlotCitation[] });

export interface ConversationSummary {
  readonly conversationId: string;
  readonly contactId: string;
  readonly status: 'bot_active' | 'handed_off';
  readonly handoff: { readonly reason: HandoffReason; readonly at: string } | null;
  readonly lastMessage: { readonly author: 'student' | 'bot' | 'attendant'; readonly preview: string; readonly at: string } | null;
  readonly updatedAt: string;
}

/** Modelo de leitura do painel: linha do tempo e resumo por conversa. */
export interface ConversationLog {
  /** Acrescenta as entradas e atualiza o resumo (estado, transferência, última mensagem). */
  record(conversation: Conversation, entries: readonly TimelineEntry[]): Promise<void>;
  summaries(tenantId: string): Promise<readonly ConversationSummary[]>;
  timeline(tenantId: string, conversationId: string): Promise<readonly TimelineEntry[]>;
}

export interface MetricIncrement {
  /** Dia local do estúdio, AAAA-MM-DD. */
  readonly day: string;
  readonly field: string;
  readonly by: number;
}

/** Contadores diários por estúdio (um campo por número que o painel de métricas mostra). */
export interface MetricsStore {
  add(tenantId: string, increments: readonly MetricIncrement[]): Promise<void>;
  read(tenantId: string, days: readonly string[]): Promise<Readonly<Record<string, Readonly<Record<string, number>>>>>;
}

/** Garante que um aviso proativo sai uma única vez por chave (ex.: lembrete da reserva X). */
export interface NoticeLedger {
  claim(key: string): Promise<boolean>;
}
