import { createEnvelope, MessageType, parseEnvelope } from '@wba/contracts';
import { describe, expect, it } from 'vitest';
import { toEnvelopes, toInboundCommand } from '../../src/adapters/messaging/mapping.js';

const meta = { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000010', correlationId: 'wamid.1', occurredAt: new Date('2026-03-02T12:00:00Z') };
const origin = { tenantId: 'estudio-lotus', contactId: '5511900000001', messageId: 'wamid.1', receivedAt: '2026-03-02T12:00:00Z' };

describe('mapeamento fila ↔ aplicação', () => {
  it('pedido de cancelamento vira turno de ação', () => {
    const envelope = createEnvelope(MessageType.CancellationRequested, { ...origin, bookingId: 'bk-1', source: 'button' }, meta);

    expect(toInboundCommand(envelope)).toEqual({ tenantId: 'estudio-lotus', contactId: '5511900000001', messageId: 'wamid.1', turn: { kind: 'action', action: 'cancel', targetId: 'bk-1' } });
  });

  it('mídia sem suporte vira turno unsupported e status de entrega não chega ao agente', () => {
    const media = createEnvelope(MessageType.MessageReceived, { ...origin, content: { kind: 'unsupported', description: 'image' } }, meta);
    const status = createEnvelope(MessageType.DeliveryStatusChanged, { tenantId: 't', contactId: 'c', messageId: 'm', status: 'read', occurredAt: '2026-03-02T12:00:00Z' }, meta);

    expect(toInboundCommand(media)?.turn).toEqual({ kind: 'unsupported' });
    expect(toInboundCommand(status)).toBeNull();
  });

  it('saídas viram envelopes válidos com a correlação da mensagem original', () => {
    const envelopes = toEnvelopes(
      [
        { kind: 'reply', member: { tenantId: 'estudio-lotus', contactId: '5511900000001' }, inReplyTo: 'wamid.1', reply: { kind: 'choices', body: 'Escolha', choices: [{ action: 'book', targetId: 's1', title: 'Hatha' }] } },
        { kind: 'handoff', ticket: { tenantId: 'estudio-lotus', conversationId: 'estudio-lotus:5511900000001', contactId: '5511900000001', reason: 'sensitive_topic', requestedAt: '2026-03-02T12:00:00.000Z' } },
      ],
      'wamid.1',
      new Date('2026-03-02T12:00:00Z'),
    );

    expect(envelopes.map((e) => e.type)).toEqual([MessageType.ReplyRequested, MessageType.HandoffRequested]);
    for (const envelope of envelopes) {
      expect(envelope.correlationId).toBe('wamid.1');
      expect(() => parseEnvelope(JSON.parse(JSON.stringify(envelope)))).not.toThrow();
    }
  });
});
