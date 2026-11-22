// Traduz fatos da operação em contadores diários por estúdio (os números da tela de métricas).
import { localDate } from '../agent/format.js';
import type { HandoffReason } from '../domain/events.js';
import type { MetricsStore, TurnOutcome } from './ports.js';

export class MetricsRecorder {
  constructor(
    private readonly store: MetricsStore,
    private readonly timezone: string,
  ) {}

  turn(tenantId: string, outcome: TurnOutcome, at: Date): Promise<void> {
    const day = localDate(at, this.timezone);
    const hour = this.hourOf(at);
    const increments = [
      { day, field: 'turns', by: 1 },
      { day, field: `outcome:${outcome}`, by: 1 },
    ];
    if (outcome === 'answered' || outcome === 'refused') increments.push({ day, field: `hour:${hour}:resolved`, by: 1 });
    if (outcome === 'handed_off') increments.push({ day, field: `hour:${hour}:handed_off`, by: 1 });
    return this.store.add(tenantId, increments);
  }

  handoff(tenantId: string, reason: HandoffReason, at: Date): Promise<void> {
    return this.store.add(tenantId, [{ day: localDate(at, this.timezone), field: `handoff:${reason}`, by: 1 }]);
  }

  /** Tempo entre a transferência e a primeira resposta do atendente. */
  wait(tenantId: string, seconds: number, at: Date): Promise<void> {
    const day = localDate(at, this.timezone);
    return this.store.add(tenantId, [
      { day, field: 'wait_sum', by: seconds },
      { day, field: 'wait_count', by: 1 },
    ]);
  }

  deliveryFailure(tenantId: string, at: Date): Promise<void> {
    return this.store.add(tenantId, [{ day: localDate(at, this.timezone), field: 'delivery_failed', by: 1 }]);
  }

  proactive(tenantId: string, kind: 'reminder' | 'promotion', at: Date): Promise<void> {
    return this.store.add(tenantId, [{ day: localDate(at, this.timezone), field: `proactive:${kind}`, by: 1 }]);
  }

  private hourOf(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.timezone, hour: '2-digit', hourCycle: 'h23' }).format(at).padStart(2, '0');
  }
}
