import { describe, expect, it } from 'vitest';
import { Booking } from '../../src/domain/booking.js';
import { Waitlist } from '../../src/domain/waitlist.js';
import { aSession, fullSession, NOW } from './fixtures.js';

describe('Reserva (Booking)', () => {
  const session = aSession();

  it('cancelar vaga confirmada libera lugar; cancelar posição na fila não', () => {
    const confirmed = Booking.create({ id: 'bk-1', sessionId: session.id, status: 'confirmed' });
    const queued = Booking.create({ id: 'bk-2', sessionId: session.id, status: 'waitlisted' });

    expect(confirmed.cancel(session, NOW)).toMatchObject({ freedSeat: true, booking: { status: 'canceled' } });
    expect(queued.cancel(session, NOW).freedSeat).toBe(false);
  });

  it('não cancela duas vezes nem depois do início', () => {
    const canceled = Booking.create({ id: 'bk-1', sessionId: session.id, status: 'canceled' });
    const confirmed = Booking.create({ id: 'bk-2', sessionId: session.id, status: 'confirmed' });

    expect(() => canceled.cancel(session, NOW)).toThrow(expect.objectContaining({ code: 'booking_already_canceled' }));
    expect(() => confirmed.cancel(session, session.startsAt)).toThrow(expect.objectContaining({ code: 'class_session_started' }));
  });

  it('recusa cancelar com a aula errada', () => {
    const booking = Booking.create({ id: 'bk-1', sessionId: 'outra-aula', status: 'confirmed' });

    expect(() => booking.cancel(session, NOW)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('promove só quem está na fila', () => {
    const queued = Booking.create({ id: 'bk-1', sessionId: session.id, status: 'waitlisted' });

    expect(queued.promote().status).toBe('confirmed');
    expect(() => queued.promote().promote()).toThrow(expect.objectContaining({ code: 'invalid_booking_transition' }));
  });
});

describe('Lista de espera (Waitlist)', () => {
  it('entra no fim da fila e informa a posição', () => {
    const session = fullSession({ waitlistCount: 3 });

    const { waitlist, position } = Waitlist.of(session, false).join(session, NOW, false);

    expect(position).toBe(4);
    expect(waitlist.length).toBe(4);
    expect(waitlist.includesMember()).toBe(true);
  });

  it.each([
    ['já está na fila', true, false, 'already_in_waitlist'],
    ['já tem vaga', false, true, 'already_booked'],
  ])('recusa entrada quando o aluno %s', (_name, queued, hasSeat, code) => {
    const session = fullSession();

    expect(() => Waitlist.of(session, queued).join(session, NOW, hasSeat)).toThrow(expect.objectContaining({ code }));
  });

  it('recusa fila em aula com vaga ou já começada', () => {
    const open = aSession();
    const full = fullSession();

    expect(() => Waitlist.of(open, false).join(open, NOW, false)).toThrow(expect.objectContaining({ code: 'seats_available' }));
    expect(() => Waitlist.of(full, false).join(full, full.startsAt, false)).toThrow(expect.objectContaining({ code: 'class_session_started' }));
  });

  it('promover encolhe a fila e tira o aluno se ele era o primeiro', () => {
    const session = fullSession({ waitlistCount: 0 });
    const { waitlist } = Waitlist.of(session, false).join(session, NOW, false);

    const after = waitlist.promoteNext(true);

    expect(after.length).toBe(0);
    expect(after.includesMember()).toBe(false);
    expect(() => after.promoteNext(false)).toThrow(expect.objectContaining({ code: 'invalid_booking_transition' }));
  });
});
