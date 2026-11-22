// Tradutor de entrada da ACL do WhatsApp: payload do webhook da Cloud API → comandos e eventos
// da linguagem publicada. Nenhum tipo da Meta sai desta função.
import { MessageType, type ActionSource, type ChoiceAction } from '@wba/contracts';
import { z } from 'zod';
import { MessagesChangeValue, MetaMessage, MetaStatus, WebhookPayload } from '../cloud-api-types.js';
import { decodeChoiceId } from '../../../../domain/interactive-ids.js';
import { MalformedWebhook, type Ignored, type InboundCommand, type Translated, type TranslationResult } from '../../../../domain/inbound.js';

/** Resolve o estúdio dono do número de WhatsApp Business que recebeu a mensagem. */
export interface TenantDirectory {
  tenantFor(phoneNumberId: string): string | null;
}

/** Resposta de conclusão do nosso Flow de agendamento (definida no JSON do Flow). */
const FlowCompletion = z.object({
  action: z.enum(['book', 'waitlist', 'cancel']),
  target_id: z.string().min(1).max(200),
});

export function translateWebhook(raw: unknown, tenants: TenantDirectory): TranslationResult {
  const payload = WebhookPayload.safeParse(raw);
  if (!payload.success) throw new MalformedWebhook('Cloud API', payload.error.issues.map((i) => i.path.join('.')).join(', '));

  const translated: Translated[] = [];
  const ignored: Ignored[] = [];

  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        ignored.push({ reason: 'unsupported_field', detail: change.field });
        continue;
      }
      const value = MessagesChangeValue.safeParse(change.value);
      if (!value.success) {
        ignored.push({ reason: 'malformed_item', detail: 'value' });
        continue;
      }
      const tenantId = tenants.tenantFor(value.data.metadata.phone_number_id);
      if (tenantId === null) {
        ignored.push({ reason: 'unknown_tenant', detail: value.data.metadata.phone_number_id });
        continue;
      }
      for (const item of value.data.messages ?? []) {
        const message = MetaMessage.safeParse(item);
        if (!message.success) {
          ignored.push({ reason: 'malformed_item', detail: 'message' });
          continue;
        }
        const result = translateMessage(message.data, tenantId);
        if ('reason' in result) ignored.push(result);
        else translated.push(result);
      }
      for (const item of value.data.statuses ?? []) {
        const status = MetaStatus.safeParse(item);
        if (!status.success) {
          ignored.push({ reason: 'malformed_item', detail: 'status' });
          continue;
        }
        translated.push(translateStatus(status.data, tenantId));
      }
    }
  }
  return { translated, ignored };
}

function translateMessage(message: MetaMessage, tenantId: string): Translated | Ignored {
  const origin = {
    tenantId,
    contactId: message.from,
    messageId: message.id,
    receivedAt: fromUnix(message.timestamp),
  };
  const wrap = (command: InboundCommand): Translated => ({ dedupKey: message.id, correlationId: message.id, command });
  const text = (body: string) => wrap({ type: MessageType.MessageReceived, payload: { ...origin, content: { kind: 'text', text: body, transcribed: false } } });
  const unsupported = (description: string) =>
    wrap({ type: MessageType.MessageReceived, payload: { ...origin, content: { kind: 'unsupported', description } } });
  const choice = (action: ChoiceAction, targetId: string, source: ActionSource): Translated => {
    switch (action) {
      case 'book':
        return wrap({ type: MessageType.BookingRequested, payload: { ...origin, sessionId: targetId, source } });
      case 'waitlist':
        return wrap({ type: MessageType.WaitlistRequested, payload: { ...origin, sessionId: targetId, source } });
      case 'cancel':
        return wrap({ type: MessageType.CancellationRequested, payload: { ...origin, bookingId: targetId, source } });
    }
  };

  switch (message.type) {
    case 'text':
      return message.text.body.trim() === '' ? unsupported('empty_text') : text(message.text.body.slice(0, 4096));
    case 'audio':
      return wrap({ type: MessageType.MediaReceived, payload: { ...origin, kind: 'audio', mediaId: message.audio.id, mimeType: message.audio.mime_type } });
    case 'image':
      return wrap({ type: MessageType.MediaReceived, payload: { ...origin, kind: 'image', mediaId: message.image.id, mimeType: message.image.mime_type } });
    case 'interactive': {
      const interactive = message.interactive;
      if (interactive.type === 'nfm_reply') {
        const completion = parseFlowCompletion(interactive.nfm_reply.response_json);
        return completion ? choice(completion.action, completion.target_id, 'form') : unsupported('flow_without_action');
      }
      const reply = interactive.type === 'button_reply' ? interactive.button_reply : interactive.list_reply;
      const decoded = decodeChoiceId(reply.id);
      // Id que não é nosso (ex.: botão antigo): trata o título como texto digitado.
      return decoded ? choice(decoded.action, decoded.targetId, interactive.type === 'button_reply' ? 'button' : 'list') : text(reply.title);
    }
    case 'button': {
      const decoded = decodeChoiceId(message.button.payload);
      return decoded ? choice(decoded.action, decoded.targetId, 'button') : text(message.button.text);
    }
    case 'reaction':
      return { reason: 'reaction', detail: message.id };
    case 'system':
      return { reason: 'system_message', detail: message.id };
    default:
      return unsupported(message.type);
  }
}

function translateStatus(status: MetaStatus, tenantId: string): Translated {
  const errorCode = status.errors?.[0]?.code;
  return {
    dedupKey: `status:${status.id}:${status.status}`,
    correlationId: status.id,
    command: {
      type: MessageType.DeliveryStatusChanged,
      payload: {
        tenantId,
        contactId: status.recipient_id,
        messageId: status.id,
        status: status.status,
        occurredAt: fromUnix(status.timestamp),
        ...(errorCode === undefined ? {} : { errorCode }),
      },
    },
  };
}

function parseFlowCompletion(responseJson: string): z.infer<typeof FlowCompletion> | null {
  try {
    const parsed = FlowCompletion.safeParse(JSON.parse(responseJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function fromUnix(seconds: string): string {
  return new Date(Number(seconds) * 1000).toISOString();
}
