// Adaptadores em memória: testes e execução local sem Redis.
import { ConcurrentModification, type ConversationRepository, type HandoffQueue, type HandoffTicket } from '../../application/ports.js';
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
