// Tradutor de entrada da ACL do Whatsmiau: webhook (formato Evolution API) → comandos e eventos
// da linguagem publicada. Nenhum tipo do Whatsmiau sai desta função.
import { MessageType, type ActionSource, type ChoiceAction } from '@wba/contracts';
import { MalformedWebhook, type Ignored, type InboundCommand, type Translated, type TranslationResult } from '../../../../domain/inbound.js';
import { decodeChoiceId } from '../../../../domain/interactive-ids.js';
import { MessagesUpdateData, MessagesUpsertData, WebhookEnvelope } from '../whatsmiau-types.js';

export interface InstanceDirectory {
  tenantFor(instance: string): string | null;
}

/** Mídia que o webhook trouxe embutida (base64) ou por URL; o provedor guarda até o pedido de download. */
export interface InlineMedia {
  readonly tenantId: string;
  readonly mediaId: string;
  readonly mimeType: string;
  readonly base64?: string;
  readonly url?: string;
}

export interface WhatsmiauTranslation extends TranslationResult {
  readonly inlineMedia: readonly InlineMedia[];
}

const USER_JID = '@s.whatsapp.net';

export function translateWhatsmiauWebhook(raw: unknown, instances: InstanceDirectory): WhatsmiauTranslation {
  const envelope = WebhookEnvelope.safeParse(raw);
  if (!envelope.success) throw new MalformedWebhook('Whatsmiau', envelope.error.issues.map((i) => i.path.join('.')).join(', '));
  const { event, instance, data } = envelope.data;

  const tenantId = instances.tenantFor(instance);
  if (tenantId === null) return empty([{ reason: 'unknown_tenant', detail: instance }]);

  if (event === 'messages.upsert') {
    const parsed = MessagesUpsertData.safeParse(data);
    return parsed.success ? translateUpsert(parsed.data, tenantId) : empty([{ reason: 'malformed_item', detail: 'upsert' }]);
  }
  if (event === 'messages.update') {
    const parsed = MessagesUpdateData.safeParse(data);
    return parsed.success ? translateUpdate(parsed.data, tenantId, envelope.data.date_time) : empty([{ reason: 'malformed_item', detail: 'update' }]);
  }
  return empty([{ reason: 'unsupported_field', detail: event }]);
}

function translateUpsert(data: MessagesUpsertData, tenantId: string): WhatsmiauTranslation {
  const { key } = data;
  if (key.fromMe === true) return empty([{ reason: 'own_message', detail: key.id }]);
  if (key.remoteJid.endsWith('@g.us')) return empty([{ reason: 'group_chat', detail: key.id }]);
  // Verificado no fonte do Whatsmiau (convertEventMessage e GetJidLid): `remoteJid` vem como número quando o LID
  // foi resolvido (e `remoteLid` traz o LID); só LID sem número conhecido chega como `@lid`, e esse não é roteável.
  if (!key.remoteJid.endsWith(USER_JID)) return empty([{ reason: 'unsupported_address', detail: key.id }]);

  const origin = {
    tenantId,
    contactId: key.remoteJid.slice(0, -USER_JID.length),
    messageId: key.id,
    receivedAt: new Date(data.messageTimestamp * 1000).toISOString(),
  };
  const wrap = (command: InboundCommand): Translated => ({ dedupKey: key.id, correlationId: key.id, command });
  const text = (body: string) => wrap({ type: MessageType.MessageReceived, payload: { ...origin, content: { kind: 'text', text: body.slice(0, 4096), transcribed: false } } });
  const unsupported = (description: string) =>
    wrap({ type: MessageType.MessageReceived, payload: { ...origin, content: { kind: 'unsupported', description: description.slice(0, 64) } } });
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
  const media = (kind: 'audio' | 'image', mimeType: string | undefined): WhatsmiauTranslation => {
    const mime = mimeType ?? (kind === 'audio' ? 'audio/ogg' : 'image/jpeg');
    const { base64, mediaUrl } = data.message ?? {};
    return {
      translated: [wrap({ type: MessageType.MediaReceived, payload: { ...origin, kind, mediaId: key.id, mimeType: mime } })],
      ignored: [],
      inlineMedia: [
        { tenantId, mediaId: key.id, mimeType: mime, ...(base64 ? { base64 } : {}), ...(mediaUrl ? { url: mediaUrl } : {}) },
      ],
    };
  };
  const one = (item: Translated): WhatsmiauTranslation => ({ translated: [item], ignored: [], inlineMedia: [] });

  const message = data.message;
  if (message === undefined) return one(unsupported(data.messageType));
  if (message.audioMessage) return media('audio', message.audioMessage.mimetype);
  if (message.imageMessage) return media('image', message.imageMessage.mimetype);
  if (message.reactionMessage !== undefined) return empty([{ reason: 'reaction', detail: key.id }]);

  const list = message.listResponseMessage;
  if (list) {
    const decoded = decodeChoiceId(list.singleSelectReply?.selectedRowId ?? '');
    if (decoded) return one(choice(decoded.action, decoded.targetId, 'list'));
    return one(list.title ? text(list.title) : unsupported('list_reply'));
  }
  const button = message.buttonsResponseMessage;
  if (button) {
    const decoded = decodeChoiceId(button.selectedButtonId ?? '');
    if (decoded) return one(choice(decoded.action, decoded.targetId, 'button'));
    return one(button.selectedDisplayText ? text(button.selectedDisplayText) : unsupported('button_reply'));
  }

  const body = message.conversation ?? message.extendedTextMessage?.text;
  if (body !== undefined) return one(body.trim() === '' ? unsupported('empty_text') : text(body));
  return one(unsupported(data.messageType));
}

const STATUS: Record<string, 'delivered' | 'read'> = { DELIVERY_ACK: 'delivered', READ: 'read' };

function translateUpdate(data: MessagesUpdateData, tenantId: string, dateTime: string | undefined): WhatsmiauTranslation {
  const status = STATUS[data.status];
  const messageId = data.keyId ?? data.messageId;
  if (status === undefined || messageId === undefined) return empty([{ reason: 'unsupported_event', detail: data.status }]);
  if (!data.remoteJid.endsWith(USER_JID)) return empty([{ reason: 'unsupported_address', detail: messageId }]);
  const occurredAt = dateTime && !Number.isNaN(Date.parse(dateTime)) ? new Date(dateTime).toISOString() : new Date(0).toISOString();
  return {
    translated: [
      {
        dedupKey: `status:${messageId}:${status}`,
        correlationId: messageId,
        command: {
          type: MessageType.DeliveryStatusChanged,
          payload: { tenantId, contactId: data.remoteJid.slice(0, -USER_JID.length), messageId, status, occurredAt },
        },
      },
    ],
    ignored: [],
    inlineMedia: [],
  };
}

function empty(ignored: readonly Ignored[]): WhatsmiauTranslation {
  return { translated: [], ignored, inlineMedia: [] };
}
