// Montagem das entradas da linha do tempo a partir do que o domínio e o agente produziram.
import { randomUUID } from 'node:crypto';
import type { OfferedSlot } from '../domain/conversation.js';
import type { HandoffReason } from '../domain/events.js';
import type { Reply, SlotCitation, TimelineEntry, TurnOutcome, Turn } from './ports.js';

const PREVIEW_MAX = 120;

export const preview = (text: string): string => (text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`);

export function citationsOf(slots: readonly OfferedSlot[], fetchedAt: string): SlotCitation[] {
  return slots.map((slot) => ({
    sessionId: slot.sessionId,
    title: slot.title,
    instructorName: slot.instructorName,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timezone: slot.timezone,
    capacity: slot.capacity,
    confirmedCount: slot.confirmedCount,
    waitlistCount: slot.waitlistCount,
    fetchedAt,
    tool: 'listar_horarios',
  }));
}

const ACTION_LABEL = { book: 'Reservar', waitlist: 'Entrar na fila', cancel: 'Cancelar reserva' } as const;

export function studentEntry(params: { turn: Turn; messageId: string; at: Date; offer: readonly OfferedSlot[] }): TimelineEntry {
  const { turn, messageId, at, offer } = params;
  const base = { id: randomUUID(), at: at.toISOString(), kind: 'student' as const, messageId };
  if (turn.kind === 'text') return { ...base, text: turn.text, transcribed: turn.transcribed ?? false, action: null };
  if (turn.kind === 'unsupported') return { ...base, text: 'Mensagem de um tipo que o bot não lê (imagem, figurinha, localização).', transcribed: false, action: null };
  const slot = offer.find((s) => s.sessionId === turn.targetId || s.booking?.id === turn.targetId);
  const label = ACTION_LABEL[turn.action];
  return { ...base, text: slot ? `${label}: ${slot.title}` : label, transcribed: false, action: { action: turn.action, targetId: turn.targetId } };
}

export function botEntries(params: { replies: readonly Reply[]; outcome: TurnOutcome; citations: readonly SlotCitation[]; at: Date }): TimelineEntry[] {
  return params.replies.map((reply): TimelineEntry => {
    const text = reply.kind === 'text' ? reply.text : reply.kind === 'choices' ? reply.body : reply.params.join(' · ');
    return {
      id: randomUUID(),
      at: params.at.toISOString(),
      kind: 'bot',
      text,
      choices: reply.kind === 'choices' ? reply.choices : [],
      citations: params.citations,
      outcome: params.outcome,
    };
  });
}

export const handoffEntry = (reason: HandoffReason, at: Date): TimelineEntry => ({ id: randomUUID(), at: at.toISOString(), kind: 'handoff', reason });
export const resumedEntry = (at: Date): TimelineEntry => ({ id: randomUUID(), at: at.toISOString(), kind: 'resumed' });
export const attendantEntry = (text: string, at: Date): TimelineEntry => ({ id: randomUUID(), at: at.toISOString(), kind: 'attendant', text });
