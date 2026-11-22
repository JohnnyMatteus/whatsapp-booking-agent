import type { Metrics } from '../api/schemas';

export type Tone = 'success' | 'warning' | 'error';

export interface Indicator {
  key: string;
  label: string;
  value: string;
  goal: string;
  tone: Tone;
  action: string;
}

const pct = (n: number): string => `${String(Math.round(n * 100))}%`;

export function waitText(seconds: number | null): string {
  if (seconds === null) return 'sem transferências';
  return seconds < 60 ? `${String(Math.round(seconds))} s` : `${String(Math.round(seconds / 60))} min`;
}

/** Cada indicador sempre aparece com a meta e a ação: número sem meta não vira decisão. */
export function indicatorsOf(m: Metrics): Indicator[] {
  const resolvedOk = m.botResolutionRate >= m.goals.botResolutionRate;
  const waitOk = m.avgWaitSeconds === null || m.avgWaitSeconds <= m.goals.avgWaitSeconds;
  return [
    {
      key: 'resolution',
      label: 'Resolvidas pelo bot',
      value: pct(m.botResolutionRate),
      goal: `meta ${pct(m.goals.botResolutionRate)}`,
      tone: resolvedOk ? 'success' : 'warning',
      action: resolvedOk ? 'Dentro da meta.' : 'Ver os motivos de transferência.',
    },
    {
      key: 'wait',
      label: 'Espera média até humano',
      value: waitText(m.avgWaitSeconds),
      goal: `meta ${waitText(m.goals.avgWaitSeconds)}`,
      tone: waitOk ? 'success' : 'error',
      action: waitOk ? 'Dentro da meta.' : 'Reforçar a recepção nos horários de pico.',
    },
    {
      key: 'delivery',
      label: 'Falhas de entrega',
      value: String(m.deliveryFailures),
      goal: 'meta 0',
      tone: m.deliveryFailures === 0 ? 'success' : 'error',
      action: m.deliveryFailures === 0 ? 'Nenhuma falha no período.' : 'Ver as mensagens com falha.',
    },
  ];
}
