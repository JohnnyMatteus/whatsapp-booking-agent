import { describe, expect, it } from 'vitest';
import { isDomainError } from '../../src/domain/errors.js';
import { aSession, fullSession, NOW } from './fixtures.js';

describe('Aula (ClassSession)', () => {
  it.each([
    ['termina antes de começar', { endsAt: new Date('2026-03-03T20:00:00Z') }],
    ['capacidade zero', { capacity: 0, confirmedCount: 0 }],
    ['mais confirmados que vagas', { capacity: 5, confirmedCount: 6 }],
    ['fila com vaga sobrando', { confirmedCount: 3, waitlistCount: 1 }],
    ['fuso inexistente', { timezone: 'America/Atlantida' }],
  ])('rejeita invariante quebrada: %s', (_name, overrides) => {
    expect(() => aSession(overrides)).toThrow(expect.objectContaining({ code: 'invalid_class_session' }));
  });

  it('oferece vaga enquanto houver lugar e fila quando lota', () => {
    expect(aSession().bookingOutcomeAt(NOW)).toBe('seat');
    expect(fullSession().bookingOutcomeAt(NOW)).toBe('waitlist');
  });

  it('considera começada exatamente no horário de início', () => {
    const session = aSession();

    expect(session.hasStartedAt(new Date(session.startsAt.getTime() - 1))).toBe(false);
    expect(session.hasStartedAt(session.startsAt)).toBe(true);
    expect(() => session.bookingOutcomeAt(session.startsAt)).toThrow(expect.objectContaining({ code: 'class_session_started' }));
  });

  it('só abre lista de espera em aula lotada', () => {
    expect(() => aSession().assertWaitlistOpenAt(NOW)).toThrow(expect.objectContaining({ code: 'seats_available' }));
    expect(() => fullSession().assertWaitlistOpenAt(NOW)).not.toThrow();
  });

  it('não deixa alterar o horário por referência', () => {
    const session = aSession();
    session.startsAt.setUTCFullYear(2000);

    expect(session.startsAt.getUTCFullYear()).toBe(2026);
  });

  it('expõe erros com código estável', () => {
    try {
      aSession({ capacity: -1 });
    } catch (error) {
      expect(isDomainError(error, 'invalid_class_session')).toBe(true);
    }
  });
});
