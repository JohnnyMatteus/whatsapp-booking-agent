// Contrato da API do painel (booking-agent), validado na fronteira: resposta fora do formato vira erro.
import { z } from 'zod';

const iso = z.string();
export const HandoffReason = z.enum(['explicit_request', 'repeated_failure', 'sensitive_topic']);
export type HandoffReason = z.infer<typeof HandoffReason>;

export const SlotCitation = z.object({
  sessionId: z.string(),
  title: z.string(),
  instructorName: z.string(),
  startsAt: iso,
  endsAt: iso,
  timezone: z.string(),
  capacity: z.number(),
  confirmedCount: z.number(),
  waitlistCount: z.number(),
  fetchedAt: iso,
  tool: z.string(),
});
export type SlotCitation = z.infer<typeof SlotCitation>;

const Choice = z.object({ action: z.enum(['book', 'waitlist', 'cancel']), targetId: z.string(), title: z.string(), description: z.string().optional() });

export const TimelineEntry = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('student'),
    at: iso,
    text: z.string(),
    transcribed: z.boolean(),
    messageId: z.string(),
    action: z.object({ action: z.enum(['book', 'cancel', 'waitlist']), targetId: z.string() }).nullable(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('bot'),
    at: iso,
    text: z.string(),
    choices: z.array(Choice),
    citations: z.array(SlotCitation),
    outcome: z.enum(['answered', 'refused', 'handed_off', 'failed']),
  }),
  z.object({ id: z.string(), kind: z.literal('attendant'), at: iso, text: z.string() }),
  z.object({ id: z.string(), kind: z.literal('handoff'), at: iso, reason: HandoffReason }),
  z.object({ id: z.string(), kind: z.literal('resumed'), at: iso }),
  z.object({ id: z.string(), kind: z.literal('template'), at: iso, template: z.enum(['lembrete_aula', 'vaga_liberada']), text: z.string(), citations: z.array(SlotCitation) }),
]);
export type TimelineEntry = z.infer<typeof TimelineEntry>;

const Status = z.enum(['bot_active', 'handed_off']);
const Handoff = z.object({ reason: HandoffReason, at: iso }).nullable();

export const ConversationSummary = z.object({
  conversationId: z.string(),
  contact: z.string(),
  status: Status,
  handoff: Handoff,
  lastMessage: z.object({ author: z.enum(['student', 'bot', 'attendant']), preview: z.string(), at: iso }).nullable(),
  updatedAt: iso,
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationList = z.object({ data: z.array(ConversationSummary), meta: z.object({ waiting: z.number(), botActive: z.number() }) });
export type ConversationList = z.infer<typeof ConversationList>;

export const ConversationDetail = z.object({
  conversationId: z.string(),
  contact: z.string(),
  status: Status,
  handoff: Handoff,
  correlationId: z.string().nullable(),
  consecutiveFailures: z.number(),
  lastInboundAt: iso.nullable(),
  serviceWindowEndsAt: iso.nullable(),
  timeline: z.array(TimelineEntry),
  context: z.object({
    offeredAt: iso.nullable(),
    offeredSlots: z.array(SlotCitation),
    bookings: z.array(
      z.object({ sessionId: z.string(), bookingId: z.string(), title: z.string(), startsAt: iso, timezone: z.string(), status: z.enum(['confirmed', 'waitlisted']), fetchedAt: iso }),
    ),
    linked: z.boolean().nullable(),
  }),
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

export const Metrics = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  totals: z.object({ turns: z.number(), answered: z.number(), refused: z.number(), handedOff: z.number(), failed: z.number() }),
  botResolutionRate: z.number(),
  goals: z.object({ botResolutionRate: z.number(), avgWaitSeconds: z.number() }),
  avgWaitSeconds: z.number().nullable(),
  deliveryFailures: z.number(),
  handoffsByReason: z.record(HandoffReason, z.number()),
  hourly: z.array(z.object({ hour: z.number(), resolved: z.number(), handedOff: z.number() })),
  proactive: z.object({ reminders: z.number(), waitlistPromotions: z.number() }),
});
export type Metrics = z.infer<typeof Metrics>;

export const Scope = z.object({
  intents: z.array(z.object({ intent: z.string(), label: z.string(), examples: z.array(z.string()) })),
  handoffTriggers: z.array(z.object({ reason: HandoffReason, label: z.string(), examples: z.array(z.string()) })),
  outOfScopeExamples: z.array(z.string()),
  refusal: z.string(),
});
export type Scope = z.infer<typeof Scope>;

export const SentMessage = z.object({ entry: TimelineEntry });
