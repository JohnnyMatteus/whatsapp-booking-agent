// Varre as conversas do estúdio atrás de reservas confirmadas que começam nas próximas horas
// e envia o lembrete por template. A confirmação final é do NotifyStudent (consulta à agenda).
import type { Clock, ConversationLog, ConversationRepository } from './ports.js';
import type { NotifyStudent } from './notify-student.js';

const HOUR_MS = 60 * 60 * 1000;

export interface ReminderOptions {
  /** Quanto antes da aula o lembrete pode sair. */
  readonly leadMs?: number;
  /** Aulas começando antes disso não recebem mais lembrete (não dá tempo de agir). */
  readonly minLeadMs?: number;
}

export class ReminderScheduler {
  constructor(
    private readonly deps: { log: ConversationLog; conversations: ConversationRepository; notify: NotifyStudent; clock: Clock; onError?: (error: unknown) => void },
    private readonly options: ReminderOptions = {},
  ) {}

  /** Devolve quantos lembretes saíram. */
  async tick(tenantId: string): Promise<number> {
    const { log, conversations, notify, clock } = this.deps;
    const now = clock.now().getTime();
    const from = now + (this.options.minLeadMs ?? HOUR_MS);
    const to = now + (this.options.leadMs ?? 24 * HOUR_MS);
    let sent = 0;

    for (const summary of await log.summaries(tenantId)) {
      const conversation = await conversations.load(tenantId, summary.contactId);
      for (const slot of conversation?.snapshot().offeredSlots ?? []) {
        const start = Date.parse(slot.startsAt);
        if (slot.booking?.status !== 'confirmed' || start < from || start > to) continue;
        try {
          const result = await notify.execute({ tenantId, contactId: summary.contactId, kind: 'reminder', sessionId: slot.sessionId, date: notify.dayOf(slot.startsAt) });
          if (result === 'sent') sent++;
        } catch (error) {
          // Reserva cancelada desde a última oferta, agenda fora do ar etc.: tenta de novo no próximo ciclo.
          this.deps.onError?.(error);
        }
      }
    }
    return sent;
  }
}
