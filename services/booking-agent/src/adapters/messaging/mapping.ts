// Fronteira entre a linguagem publicada (contratos da fila) e a camada de aplicação.
import { createEnvelope, MessageType, type AnyEnvelope } from '@wba/contracts';
import { randomUUID } from 'node:crypto';
import type { InboundCommand, OutboundMessage } from '../../application/ports.js';

/** null = mensagem que o agente não processa (ex.: status de entrega, só métrica). */
export function toInboundCommand(envelope: AnyEnvelope): InboundCommand | null {
  switch (envelope.type) {
    case MessageType.MessageReceived: {
      const { tenantId, contactId, messageId, content } = envelope.payload;
      return {
        tenantId,
        contactId,
        messageId,
        turn: content.kind === 'text' ? { kind: 'text', text: content.text } : { kind: 'unsupported' },
      };
    }
    case MessageType.BookingRequested:
      return { ...origin(envelope.payload), turn: { kind: 'action', action: 'book', targetId: envelope.payload.sessionId } };
    case MessageType.WaitlistRequested:
      return { ...origin(envelope.payload), turn: { kind: 'action', action: 'waitlist', targetId: envelope.payload.sessionId } };
    case MessageType.CancellationRequested:
      return { ...origin(envelope.payload), turn: { kind: 'action', action: 'cancel', targetId: envelope.payload.bookingId } };
    default:
      return null;
  }
}

function origin(payload: { tenantId: string; contactId: string; messageId: string }) {
  return { tenantId: payload.tenantId, contactId: payload.contactId, messageId: payload.messageId };
}

export function toEnvelopes(messages: readonly OutboundMessage[], correlationId: string, now: Date): AnyEnvelope[] {
  return messages.map((message): AnyEnvelope => {
    const meta = { id: randomUUID(), correlationId, occurredAt: now };
    if (message.kind === 'reply') {
      return createEnvelope(
        MessageType.ReplyRequested,
        {
          tenantId: message.member.tenantId,
          contactId: message.member.contactId,
          inReplyTo: message.inReplyTo,
          content: message.reply.kind === 'text' ? message.reply : { ...message.reply, choices: [...message.reply.choices] },
        },
        meta,
      );
    }
    return createEnvelope(MessageType.HandoffRequested, { ...message.ticket }, meta);
  });
}
