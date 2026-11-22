// Adaptadores em memória: testes e execução local sem Redis.
import {
  ConcurrentModification,
  type ConversationLog,
  type ConversationRepository,
  type ConversationSummary,
  type HandoffQueue,
  type HandoffTicket,
  type MediaNote,
  type MediaNotes,
  type MetricIncrement,
  type MetricsStore,
  type NoticeLedger,
  type TimelineEntry,
} from '../../application/ports.js';
import { TIMELINE_LIMIT, summarize } from './summary.js';
import { Conversation, type ConversationSnapshot } from '../../domain/conversation.js';

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, ConversationSnapshot>();

  async load(tenantId: string, contactId: string): Promise<Conversation | null> {
    const snapshot = this.store.get(`${tenantId}:${contactId}`);
    return snapshot ? Conversation.restore(snapshot) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    const next = conversation.snapshot();
    const current = this.store.get(next.id);
    if ((current?.version ?? 0) !== next.version) throw new ConcurrentModification(next.id);
    this.store.set(next.id, { ...next, version: next.version + 1 });
  }
}

export class InMemoryHandoffQueue implements HandoffQueue {
  private readonly tickets = new Map<string, HandoffTicket>();

  async enqueue(ticket: HandoffTicket): Promise<void> {
    this.tickets.set(`${ticket.tenantId}|${ticket.conversationId}`, ticket);
  }

  async list(tenantId: string): Promise<readonly HandoffTicket[]> {
    return [...this.tickets.values()].filter((t) => t.tenantId === tenantId).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async remove(tenantId: string, conversationId: string): Promise<void> {
    this.tickets.delete(`${tenantId}|${conversationId}`);
  }
}

export class InMemoryConversationLog implements ConversationLog {
  private readonly summariesById = new Map<string, ConversationSummary & { tenantId: string }>();
  private readonly timelines = new Map<string, TimelineEntry[]>();

  async record(conversation: Conversation, entries: readonly TimelineEntry[]): Promise<void> {
    const key = `${conversation.tenantId}|${conversation.id}`;
    const timeline = [...(this.timelines.get(key) ?? []), ...entries].slice(-TIMELINE_LIMIT);
    this.timelines.set(key, timeline);
    this.summariesById.set(key, { tenantId: conversation.tenantId, ...summarize(conversation, timeline) });
  }

  async summaries(tenantId: string): Promise<readonly ConversationSummary[]> {
    return [...this.summariesById.values()].filter((s) => s.tenantId === tenantId);
  }

  async timeline(tenantId: string, conversationId: string): Promise<readonly TimelineEntry[]> {
    return this.timelines.get(`${tenantId}|${conversationId}`) ?? [];
  }
}

export class InMemoryMetricsStore implements MetricsStore {
  private readonly counters = new Map<string, number>();

  async add(tenantId: string, increments: readonly MetricIncrement[]): Promise<void> {
    for (const { day, field, by } of increments) {
      const key = `${tenantId}|${day}|${field}`;
      this.counters.set(key, (this.counters.get(key) ?? 0) + by);
    }
  }

  async read(tenantId: string, days: readonly string[]): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [key, value] of this.counters) {
      const [tenant, day, ...field] = key.split('|');
      if (tenant !== tenantId || !day || !days.includes(day)) continue;
      (out[day] ??= {})[field.join('|')] = value;
    }
    return out;
  }
}

export class InMemoryNoticeLedger implements NoticeLedger {
  private readonly claimed = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

export class InMemoryMediaNotes implements MediaNotes {
  private readonly notes = new Map<string, MediaNote>();

  async save(tenantId: string, messageId: string, note: MediaNote): Promise<void> {
    this.notes.set(`${tenantId}\u0000${messageId}`, note);
  }

  async find(tenantId: string, messageId: string): Promise<MediaNote | null> {
    return this.notes.get(`${tenantId}\u0000${messageId}`) ?? null;
  }
}
