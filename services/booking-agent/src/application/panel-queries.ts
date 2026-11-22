// Consultas do painel (lado de leitura): fila, conversa com contexto, métricas e política de escopo.
import { localDate } from '../agent/format.js';
import { DomainError } from '../domain/errors.js';
import type { HandoffReason } from '../domain/events.js';
import type { Clock, ConversationLog, ConversationRepository, ConversationSummary, MediaNotes, MetricsStore, SlotCitation, ThumbnailSource, TimelineEntry } from './ports.js';
import { citationsOf } from './timeline.js';

export const GOALS = { botResolutionRate: 0.7, avgWaitSeconds: 300 } as const;
const HANDOFF_REASONS: readonly HandoffReason[] = ['explicit_request', 'repeated_failure', 'sensitive_topic'];
const MAX_LIST = 100;

export type StatusFilter = 'handed_off' | 'bot_active' | 'all';

export interface ConversationDetail {
  readonly conversationId: string;
  readonly contactId: string;
  readonly status: 'bot_active' | 'handed_off';
  readonly handoff: { readonly reason: HandoffReason; readonly at: string } | null;
  readonly correlationId: string | null;
  readonly consecutiveFailures: number;
  readonly lastInboundAt: string | null;
  readonly serviceWindowEndsAt: string | null;
  readonly timeline: readonly TimelineEntry[];
  readonly context: {
    readonly offeredAt: string | null;
    readonly offeredSlots: readonly SlotCitation[];
    readonly bookings: readonly {
      readonly sessionId: string;
      readonly bookingId: string;
      readonly title: string;
      readonly startsAt: string;
      readonly timezone: string;
      readonly status: 'confirmed' | 'waitlisted';
      readonly fetchedAt: string;
    }[];
    readonly linked: boolean | null;
  };
}

export interface MetricsReport {
  readonly period: { readonly from: string; readonly to: string };
  readonly totals: { readonly turns: number; readonly answered: number; readonly refused: number; readonly handedOff: number; readonly failed: number };
  readonly botResolutionRate: number;
  readonly goals: typeof GOALS;
  readonly avgWaitSeconds: number | null;
  readonly deliveryFailures: number;
  readonly handoffsByReason: Record<HandoffReason, number>;
  readonly hourly: readonly { readonly hour: number; readonly resolved: number; readonly handedOff: number }[];
  readonly proactive: { readonly reminders: number; readonly waitlistPromotions: number };
}

export class PanelQueries {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      log: ConversationLog;
      metrics: MetricsStore;
      mediaNotes: MediaNotes;
      thumbnails: ThumbnailSource;
      clock: Clock;
      timezone: string;
    },
  ) {}

  async listConversations(tenantId: string, status: StatusFilter): Promise<{ data: ConversationSummary[]; meta: { waiting: number; botActive: number } }> {
    const all = await this.deps.log.summaries(tenantId);
    const waiting = all.filter((c) => c.status === 'handed_off').sort((a, b) => (a.handoff?.at ?? '').localeCompare(b.handoff?.at ?? ''));
    const active = all.filter((c) => c.status === 'bot_active').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const ordered = status === 'handed_off' ? waiting : status === 'bot_active' ? active : [...waiting, ...active];
    return { data: ordered.slice(0, MAX_LIST), meta: { waiting: waiting.length, botActive: active.length } };
  }

  async conversation(tenantId: string, contactId: string): Promise<ConversationDetail> {
    const conversation = await this.deps.conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    const timeline = await this.withMedia(tenantId, await this.deps.log.timeline(tenantId, conversation.id));
    const snapshot = conversation.snapshot();
    const offeredAt = snapshot.offeredAt;
    const fetchedAt = offeredAt ?? '';
    const lastStudent = [...timeline].reverse().find((e) => e.kind === 'student');
    return {
      conversationId: conversation.id,
      contactId,
      status: conversation.status,
      handoff: snapshot.handoff ? { reason: snapshot.handoff.reason, at: snapshot.handoff.at } : null,
      correlationId: lastStudent?.kind === 'student' ? lastStudent.messageId : null,
      consecutiveFailures: conversation.consecutiveFailures,
      lastInboundAt: conversation.lastInboundAt,
      serviceWindowEndsAt: conversation.serviceWindowEndsAt,
      timeline,
      context: {
        offeredAt,
        offeredSlots: citationsOf(snapshot.offeredSlots, fetchedAt),
        bookings: snapshot.offeredSlots.flatMap((slot) =>
          slot.booking ? [{ sessionId: slot.sessionId, bookingId: slot.booking.id, title: slot.title, startsAt: slot.startsAt, timezone: slot.timezone, status: slot.booking.status, fetchedAt }] : [],
        ),
        linked: conversation.linked,
      },
    };
  }

  /** Miniatura da imagem de uma mensagem do estúdio. A chave vem da anotação guardada no servidor, nunca do cliente. */
  async thumbnail(tenantId: string, messageId: string): Promise<Uint8Array> {
    const note = await this.deps.mediaNotes.find(tenantId, messageId);
    // Defesa em profundidade: a chave do armazenamento começa pelo estúdio do evento.
    if (!note?.thumbnailKey || !note.thumbnailKey.startsWith(`media/${tenantId}/`)) throw new DomainError('not_found', 'Miniatura não encontrada.');
    const bytes = await this.deps.thumbnails.fetch(note.thumbnailKey);
    if (!bytes) throw new DomainError('not_found', 'Miniatura não encontrada.');
    return bytes;
  }

  private async withMedia(tenantId: string, timeline: readonly TimelineEntry[]): Promise<readonly TimelineEntry[]> {
    return Promise.all(
      timeline.map(async (entry) => {
        if (entry.kind !== 'student') return entry;
        const note = await this.deps.mediaNotes.find(tenantId, entry.messageId);
        const media = note ? { kind: note.kind, status: note.status, rejectionReason: note.rejectionReason, hasThumbnail: note.thumbnailKey !== null } : null;
        return { ...entry, media };
      }),
    );
  }

  async metrics(tenantId: string, days: number): Promise<MetricsReport> {
    const { clock, timezone } = this.deps;
    const today = clock.now();
    const labels = Array.from({ length: days }, (_, i) => localDate(new Date(today.getTime() - (days - 1 - i) * 86_400_000), timezone));
    const perDay = await this.deps.metrics.read(tenantId, labels);
    const sum = (field: string) => labels.reduce((acc, day) => acc + (perDay[day]?.[field] ?? 0), 0);

    const turns = sum('turns');
    const answered = sum('outcome:answered');
    const refused = sum('outcome:refused');
    const waitCount = sum('wait_count');
    return {
      period: { from: labels[0] ?? '', to: labels.at(-1) ?? '' },
      totals: { turns, answered, refused, handedOff: sum('outcome:handed_off'), failed: sum('outcome:failed') },
      botResolutionRate: turns === 0 ? 0 : Number(((answered + refused) / turns).toFixed(4)),
      goals: GOALS,
      avgWaitSeconds: waitCount === 0 ? null : Math.round(sum('wait_sum') / waitCount),
      deliveryFailures: sum('delivery_failed'),
      handoffsByReason: Object.fromEntries(HANDOFF_REASONS.map((r) => [r, sum(`handoff:${r}`)])) as Record<HandoffReason, number>,
      hourly: Array.from({ length: 24 }, (_, hour) => {
        const h = String(hour).padStart(2, '0');
        return { hour, resolved: sum(`hour:${h}:resolved`), handedOff: sum(`hour:${h}:handed_off`) };
      }),
      proactive: { reminders: sum('proactive:reminder'), waitlistPromotions: sum('proactive:promotion') },
    };
  }
}
