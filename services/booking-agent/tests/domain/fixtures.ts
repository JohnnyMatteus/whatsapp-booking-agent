import { ClassSession, type ClassSessionProps } from '../../src/domain/class-session.js';

export const NOW = new Date('2026-03-02T12:00:00Z');

export function aSession(overrides: Partial<ClassSessionProps> = {}): ClassSession {
  return ClassSession.create({
    id: 'ses-hatha-1',
    title: 'Hatha Yoga',
    instructorName: 'Instrutora Exemplo',
    startsAt: new Date('2026-03-03T21:00:00Z'),
    endsAt: new Date('2026-03-03T22:00:00Z'),
    timezone: 'America/Sao_Paulo',
    capacity: 10,
    confirmedCount: 4,
    waitlistCount: 0,
    ...overrides,
  });
}

export const fullSession = (overrides: Partial<ClassSessionProps> = {}): ClassSession =>
  aSession({ capacity: 2, confirmedCount: 2, waitlistCount: 3, ...overrides });
