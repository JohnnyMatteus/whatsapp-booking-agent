import { describe, expect, it } from 'vitest';
import { Conversation, MAX_CONSECUTIVE_FAILURES, OFFER_TTL_MS } from '../../src/domain/conversation.js';
import { aSession, fullSession, NOW } from './fixtures.js';

const start = () => Conversation.start({ tenantId: 'estudio-lotus', contactId: '5511900000001' });
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('Conversa (Conversation)', () => {
  it('processa cada mensagem uma vez só', () => {
    const conversation = start();

    expect(conversation.receive('wamid.1')).toBe('process');
    expect(conversation.receive('wamid.1')).toBe('duplicate');
  });

  it('aceita escolher só aulas oferecidas e enquanto a oferta vale', () => {
    const conversation = start();
    const session = aSession();
    conversation.offerSlots([{ session, booking: null }], NOW);

    expect(conversation.offeredSlot(session.id, later(OFFER_TTL_MS)).title).toBe('Hatha Yoga');
    expect(() => conversation.offeredSlot('ses-inventada', NOW)).toThrow(expect.objectContaining({ code: 'slot_not_offered' }));
    expect(() => conversation.offeredSlot(session.id, later(OFFER_TTL_MS + 1))).toThrow(expect.objectContaining({ code: 'slot_not_offered' }));
  });

  it('oferece cancelamento só de reserva do próprio aluno', () => {
    const conversation = start();
    conversation.offerSlots(
      [
        { session: aSession(), booking: null },
        { session: fullSession({ id: 'ses-2' }), booking: { id: 'bk-9', status: 'confirmed' } },
      ],
      NOW,
    );

    expect(conversation.offeredBooking('bk-9', NOW).sessionId).toBe('ses-2');
    expect(() => conversation.offeredBooking('bk-de-outra-pessoa', NOW)).toThrow(expect.objectContaining({ code: 'slot_not_offered' }));
  });

  it(`transfere para humano na falha ${String(MAX_CONSECUTIVE_FAILURES)} seguida`, () => {
    const conversation = start();

    expect(conversation.recordFailure(NOW)).toBe('retry');
    expect(conversation.recordFailure(NOW)).toBe('handed_off');
    expect(conversation.status).toBe('handed_off');
    expect(conversation.pullEvents()).toEqual([
      expect.objectContaining({ type: 'handoff_requested', reason: 'repeated_failure' }),
    ]);
  });

  it('um acerto zera o contador de falhas', () => {
    const conversation = start();
    conversation.recordFailure(NOW);
    conversation.recordSuccess();

    expect(conversation.recordFailure(NOW)).toBe('retry');
  });

  it('transferida, guarda as mensagens mas silencia o bot e apaga a oferta', () => {
    const conversation = start();
    conversation.offerSlots([{ session: aSession(), booking: null }], NOW);
    conversation.handOff('explicit_request', NOW);

    expect(conversation.receive('wamid.2')).toBe('silenced');
    expect(conversation.receive('wamid.2')).toBe('duplicate');
    expect(conversation.currentOffer(NOW)).toEqual([]);
    expect(() => conversation.offerSlots([{ session: aSession(), booking: null }], NOW)).toThrow(expect.objectContaining({ code: 'conversation_handed_off' }));
  });

  it('pedir transferência de novo não duplica o evento', () => {
    const conversation = start();
    conversation.handOff('sensitive_topic', NOW);
    conversation.handOff('explicit_request', NOW);

    expect(conversation.pullEvents()).toHaveLength(1);
    expect(conversation.snapshot().handoff?.reason).toBe('sensitive_topic');
  });

  it('o atendente devolve a conversa ao bot com contador zerado', () => {
    const conversation = start();
    conversation.recordFailure(NOW);
    conversation.recordFailure(NOW);
    conversation.pullEvents();

    conversation.resumeBot(NOW);

    expect(conversation.isBotActive()).toBe(true);
    expect(conversation.consecutiveFailures).toBe(0);
    expect(conversation.pullEvents()).toEqual([expect.objectContaining({ type: 'bot_resumed' })]);
    expect(() => conversation.resumeBot(NOW)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('restaura do snapshot sem compartilhar estado', () => {
    const original = start();
    original.receive('wamid.1');
    const restored = Conversation.restore(original.snapshot());
    restored.receive('wamid.2');

    expect(original.snapshot().processedMessageIds).toEqual(['wamid.1']);
    expect(restored.snapshot().processedMessageIds).toEqual(['wamid.1', 'wamid.2']);
  });
});
