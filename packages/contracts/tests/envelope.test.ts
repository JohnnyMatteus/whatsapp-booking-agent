import { describe, expect, it } from 'vitest';
import { ContractViolation, createEnvelope, MessageType, parseEnvelope } from '../src/index.js';

const meta = { id: '0b4f3a52-8d1c-4f43-9a55-2d9a3f0c1e77', correlationId: 'wamid.TESTE1', occurredAt: new Date('2026-03-02T12:00:00Z') };
const origin = { tenantId: 'estudio-lotus', contactId: '5511900000001', messageId: 'wamid.TESTE1', receivedAt: '2026-03-02T12:00:00Z' };

describe('envelope do contrato', () => {
  it('faz ida e volta de um pedido de reserva', () => {
    const envelope = createEnvelope(MessageType.BookingRequested, { ...origin, sessionId: 'ses-1', source: 'list' }, meta);

    const parsed = parseEnvelope(JSON.parse(JSON.stringify(envelope)));

    expect(parsed.type).toBe(MessageType.BookingRequested);
    expect(parsed.payload).toMatchObject({ sessionId: 'ses-1' });
  });

  it('rejeita tipo desconhecido e payload incompatível com o tipo', () => {
    const valid = createEnvelope(MessageType.BookingRequested, { ...origin, sessionId: 'ses-1', source: 'form' }, meta);

    expect(() => parseEnvelope({ ...valid, type: 'inbound.unknown' })).toThrow(ContractViolation);
    expect(() => parseEnvelope({ ...valid, type: MessageType.CancellationRequested })).toThrow(/bookingId/);
  });

  it('rejeita versão de contrato diferente', () => {
    const valid = createEnvelope(MessageType.BookingRequested, { ...origin, sessionId: 'ses-1', source: 'form' }, meta);

    expect(() => parseEnvelope({ ...valid, version: 2 })).toThrow(ContractViolation);
  });

  it('limita a lista de opções ao máximo que a Cloud API aceita', () => {
    const choices = Array.from({ length: 11 }, (_, i) => ({ action: 'book' as const, targetId: `ses-${String(i)}`, title: `Aula ${String(i)}` }));

    expect(() =>
      createEnvelope(MessageType.ReplyRequested, { tenantId: 't', contactId: 'c', content: { kind: 'choices', body: 'Escolha', choices } }, meta),
    ).toThrow();
  });
});
