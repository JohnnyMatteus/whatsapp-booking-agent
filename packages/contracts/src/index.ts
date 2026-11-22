// Linguagem publicada do contexto de Agendamento (ADR 0002 e 0006).
//
// É o único vocabulário que trafega no RabbitMQ. Os tradutores da ACL de cada provedor convertem o WhatsApp
// e o SaaS para estes tipos; nenhum serviço publica payload da Meta ou do SaaS na fila.
import { z } from 'zod';

export const CONTRACT_VERSION = 1;

/** Nome do exchange topic único; a routing key é sempre o `type` da mensagem. */
export const EXCHANGE = 'wba.events';

export const MessageType = {
  MessageReceived: 'inbound.message_received',
  MediaReceived: 'inbound.media_received',
  BookingRequested: 'inbound.booking_requested',
  CancellationRequested: 'inbound.cancellation_requested',
  WaitlistRequested: 'inbound.waitlist_requested',
  DeliveryStatusChanged: 'inbound.delivery_status_changed',
  MediaProcessed: 'media.processed',
  ReplyRequested: 'outbound.reply_requested',
  HandoffRequested: 'attendance.handoff_requested',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

const id = z.string().min(1).max(256);
const isoInstant = z.iso.datetime({ offset: true });

/** Quem fala e com qual estúdio. `contactId` é o identificador do WhatsApp do aluno (dado pessoal: nunca em log). */
const Origin = z.object({
  tenantId: id,
  contactId: id,
  messageId: id,
  receivedAt: isoInstant,
});

/** Como o aluno escolheu: numa lista, num botão ou num formulário (vocabulário neutro, sem termos da Meta). */
export const ActionSource = z.enum(['list', 'button', 'form']);
export type ActionSource = z.infer<typeof ActionSource>;

export const MessageReceived = Origin.extend({
  content: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().min(1).max(4096), transcribed: z.boolean().default(false) }),
    z.object({ kind: z.literal('unsupported'), description: z.string().max(64) }),
  ]),
});
export type MessageReceived = z.infer<typeof MessageReceived>;

export const MediaKind = z.enum(['audio', 'image']);
export type MediaKind = z.infer<typeof MediaKind>;

/** Mídia recebida do aluno. `mediaId` só faz sentido para o messaging-gateway, que a resolve em bytes. */
export const MediaReceived = Origin.extend({
  kind: MediaKind,
  mediaId: id,
  mimeType: z.string().max(128),
});
export type MediaReceived = z.infer<typeof MediaReceived>;

export const MediaRejectionReason = z.enum(['unsupported_type', 'too_large', 'type_mismatch', 'corrupt', 'unavailable']);
export type MediaRejectionReason = z.infer<typeof MediaRejectionReason>;

/** Desfecho do processamento da mídia (MidiaProcessada). As chaves apontam para o armazenamento S3. */
export const MediaProcessed = Origin.extend({
  kind: MediaKind,
  status: z.enum(['processed', 'rejected']),
  mimeType: z.string().max(128),
  sizeBytes: z.number().int().nonnegative().optional(),
  storageKey: z.string().min(1).max(512).optional(),
  thumbnailKey: z.string().min(1).max(512).optional(),
  transcribed: z.boolean().default(false),
  rejectionReason: MediaRejectionReason.optional(),
});
export type MediaProcessed = z.infer<typeof MediaProcessed>;

export const BookingRequested = Origin.extend({ sessionId: id, source: ActionSource });
export type BookingRequested = z.infer<typeof BookingRequested>;

export const CancellationRequested = Origin.extend({ bookingId: id, source: ActionSource });
export type CancellationRequested = z.infer<typeof CancellationRequested>;

export const WaitlistRequested = Origin.extend({ sessionId: id, source: ActionSource });
export type WaitlistRequested = z.infer<typeof WaitlistRequested>;

export const DeliveryStatusChanged = z.object({
  tenantId: id,
  contactId: id,
  messageId: id,
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  occurredAt: isoInstant,
  errorCode: z.number().int().optional(),
});
export type DeliveryStatusChanged = z.infer<typeof DeliveryStatusChanged>;

export const ChoiceAction = z.enum(['book', 'waitlist', 'cancel']);
export type ChoiceAction = z.infer<typeof ChoiceAction>;

export const Choice = z.object({
  action: ChoiceAction,
  targetId: id,
  title: z.string().min(1).max(80),
  description: z.string().max(160).optional(),
});
export type Choice = z.infer<typeof Choice>;

/** Conteúdo neutro de saída. O adaptador do provedor decide se vira texto, botões ou lista. */
/** Templates aprovados na Meta para mensagens iniciadas pelo estúdio (fora da janela de 24 h). */
export const TemplateName = z.enum(['lembrete_aula', 'vaga_liberada']);
export type TemplateName = z.infer<typeof TemplateName>;

export const ReplyContent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal('choices'),
    body: z.string().min(1).max(1024),
    choices: z.array(Choice).min(1).max(10),
  }),
  z.object({ kind: z.literal('template'), template: TemplateName, params: z.array(z.string().min(1).max(256)).min(1).max(5) }),
]);
export type ReplyContent = z.infer<typeof ReplyContent>;

export const ReplyRequested = z.object({
  tenantId: id,
  contactId: id,
  inReplyTo: id.optional(),
  content: ReplyContent,
});
export type ReplyRequested = z.infer<typeof ReplyRequested>;

export const HandoffReason = z.enum(['explicit_request', 'repeated_failure', 'sensitive_topic']);
export type HandoffReason = z.infer<typeof HandoffReason>;

export const HandoffRequested = z.object({
  tenantId: id,
  conversationId: id,
  contactId: id,
  reason: HandoffReason,
  requestedAt: isoInstant,
});
export type HandoffRequested = z.infer<typeof HandoffRequested>;

const payloadSchemas = {
  [MessageType.MessageReceived]: MessageReceived,
  [MessageType.MediaReceived]: MediaReceived,
  [MessageType.BookingRequested]: BookingRequested,
  [MessageType.CancellationRequested]: CancellationRequested,
  [MessageType.WaitlistRequested]: WaitlistRequested,
  [MessageType.DeliveryStatusChanged]: DeliveryStatusChanged,
  [MessageType.MediaProcessed]: MediaProcessed,
  [MessageType.ReplyRequested]: ReplyRequested,
  [MessageType.HandoffRequested]: HandoffRequested,
} as const satisfies Record<MessageType, z.ZodType>;

export type PayloadOf<T extends MessageType> = z.infer<(typeof payloadSchemas)[T]>;

export interface Envelope<T extends MessageType = MessageType> {
  readonly id: string;
  readonly type: T;
  readonly version: typeof CONTRACT_VERSION;
  readonly occurredAt: string;
  /** Propaga o id da mensagem original do WhatsApp por todos os saltos (logs e traces). */
  readonly correlationId: string;
  readonly payload: PayloadOf<T>;
}

export type AnyEnvelope = { [T in MessageType]: Envelope<T> }[MessageType];

const EnvelopeHeader = z.object({
  id: z.uuid(),
  type: z.enum(Object.values(MessageType) as [MessageType, ...MessageType[]]),
  version: z.literal(CONTRACT_VERSION),
  occurredAt: isoInstant,
  correlationId: id,
  payload: z.unknown(),
});

export class ContractViolation extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Mensagem fora do contrato: ${issues.join('; ')}`);
    this.name = 'ContractViolation';
  }
}

/** Valida cabeçalho e payload. Mensagem inválida não tem retry: vai direto para a DLQ. */
export function parseEnvelope(raw: unknown): AnyEnvelope {
  const header = EnvelopeHeader.safeParse(raw);
  if (!header.success) throw new ContractViolation(formatIssues(header.error));
  const payload = payloadSchemas[header.data.type].safeParse(header.data.payload);
  if (!payload.success) throw new ContractViolation(formatIssues(payload.error));
  return { ...header.data, payload: payload.data } as AnyEnvelope;
}

export function createEnvelope<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  meta: { id: string; correlationId: string; occurredAt: Date },
): Envelope<T> {
  return {
    id: meta.id,
    type,
    version: CONTRACT_VERSION,
    occurredAt: meta.occurredAt.toISOString(),
    correlationId: meta.correlationId,
    payload: payloadSchemas[type].parse(payload) as PayloadOf<T>,
  };
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`);
}
