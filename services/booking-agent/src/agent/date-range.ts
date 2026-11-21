// Interpreta referências de dia simples ("hoje", "amanhã", "sexta") de forma determinística.
// Sem referência, a busca cobre os próximos 7 dias.
import type { DateRange } from '../application/ports.js';
import { normalize } from '../domain/scope-policy.js';
import { localDate } from './format.js';

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RANGE_DAYS = 7;

export function dateRangeFor(text: string, now: Date, timezone: string): DateRange {
  const normalized = normalize(text);
  const day = (offset: number) => localDate(new Date(now.getTime() + offset * DAY_MS), timezone);

  if (/\bdepois de amanha\b/.test(normalized)) return { from: day(2), to: day(2) };
  if (/\bamanha\b/.test(normalized)) return { from: day(1), to: day(1) };
  if (/\bhoje\b/.test(normalized)) return { from: day(0), to: day(0) };

  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}(-feira)?\\b`).test(normalized));
  if (weekday >= 0) {
    const today = new Date(`${day(0)}T12:00:00Z`).getUTCDay();
    const offset = (weekday - today + 7) % 7;
    return { from: day(offset), to: day(offset) };
  }
  return { from: day(0), to: day(DEFAULT_RANGE_DAYS - 1) };
}

export function dateRangeForIsoDay(isoDay: string): DateRange {
  return { from: isoDay, to: isoDay };
}
