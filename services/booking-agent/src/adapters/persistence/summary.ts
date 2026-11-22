// Resumo da conversa para a fila do painel, calculado igual nos adaptadores Redis e em memória.
import type { ConversationSummary, TimelineEntry } from '../../application/ports.js';
import { preview } from '../../application/timeline.js';
import type { Conversation } from '../../domain/conversation.js';

export const TIMELINE_LIMIT = 200;

export function summarize(conversation: Conversation, timeline: readonly TimelineEntry[]): ConversationSummary {
  const last = [...timeline].reverse().find((e) => e.kind === 'student' || e.kind === 'bot' || e.kind === 'attendant' || e.kind === 'template');
  const handoff = conversation.handoff;
  return {
    conversationId: conversation.id,
    contactId: conversation.contactId,
    status: conversation.status,
    handoff: handoff ? { reason: handoff.reason, at: handoff.at } : null,
    lastMessage: last ? { author: last.kind === 'template' ? 'bot' : last.kind, preview: preview(last.text), at: last.at } : null,
    updatedAt: timeline.at(-1)?.at ?? new Date(0).toISOString(),
  };
}
