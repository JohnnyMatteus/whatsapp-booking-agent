import { ptBR } from 'date-fns/locale';
import { formatDistanceStrict } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export const STUDIO_TIMEZONE = import.meta.env.VITE_STUDIO_TIMEZONE ?? 'America/Sao_Paulo';

/** "09:41", no fuso do estúdio. */
export const clock = (iso: string, timezone = STUDIO_TIMEZONE): string => formatInTimeZone(new Date(iso), timezone, 'HH:mm', { locale: ptBR });

/** "ter 03/03 18:00": o formato dos horários das aulas, igual ao que o bot usa com o aluno. */
export const slotTime = (iso: string, timezone = STUDIO_TIMEZONE): string =>
  formatInTimeZone(new Date(iso), timezone, 'EEE dd/MM HH:mm', { locale: ptBR }).replace('.', '');

/** "4 min", "2 h": quanto falta ou quanto passou, para a fila ler de relance. */
export function elapsed(fromIso: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return 'agora';
  return formatDistanceStrict(Date.parse(fromIso), now, { locale: ptBR, roundingMethod: 'floor' }).replace('minutos', 'min').replace('minuto', 'min').replace('horas', 'h').replace('hora', 'h');
}

export type Deadline = 'ok' | 'soon' | 'overdue';

/** Prazo de primeira resposta: verde até 60% da meta, âmbar até a meta, vermelho depois. */
export function deadlineOf(handoffAt: string, now: Date, goalSeconds: number): { status: Deadline; ratio: number } {
  const ratio = Math.max(0, (now.getTime() - Date.parse(handoffAt)) / 1000 / goalSeconds);
  return { status: ratio >= 1 ? 'overdue' : ratio >= 0.6 ? 'soon' : 'ok', ratio: Math.min(ratio, 1) };
}

export const DEADLINE_LABEL: Record<Deadline, string> = { ok: 'dentro do prazo', soon: 'prazo chegando', overdue: 'prazo estourado' };
