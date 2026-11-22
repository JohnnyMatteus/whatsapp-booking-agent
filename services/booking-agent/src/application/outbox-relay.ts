// Publica as entradas da caixa de saída. O turno publica a sua própria entrada logo depois de salvar; o
// varredor publica o que sobrou (broker fora do ar, processo que caiu entre salvar e publicar).
// Entrega pelo menos uma vez: se a publicação passar e o `complete` falhar, a entrada sai de novo quando a
// reserva vencer. É a duplicata rara de sempre (ADR 0005). Uma entrada já concluída nunca volta: a reserva
// só vale se a entrada ainda existir (`Outbox.claim`), mesmo para quem a leu antes de ser concluída.
import type { Outbox, OutboxEntry, OutboundPublisher } from './ports.js';

export const OUTBOX_LEASE_SECONDS = 30;

export class OutboxRelay {
  private sweeping: Promise<number> | null = null;

  constructor(
    private readonly deps: { outbox: Outbox; publisher: OutboundPublisher; onError?: (error: unknown) => void },
  ) {}

  /** true se esta chamada publicou a entrada. */
  async deliver(entry: Pick<OutboxEntry, 'id'>): Promise<boolean> {
    const { outbox, publisher, onError } = this.deps;
    const claimed = await outbox.claim(entry.id, OUTBOX_LEASE_SECONDS);
    if (!claimed) return false;
    try {
      await publisher.publish(claimed.messages, claimed.correlationId);
      await outbox.complete(claimed.id);
      return true;
    } catch (error) {
      onError?.(error);
      return false;
    }
  }

  /**
   * Devolve quantas entradas publicou. Varreduras não se sobrepõem no processo: uma chamada durante outra
   * em andamento espera por ela e devolve o mesmo resultado, em vez de ler a lista de novo.
   */
  sweep(limit = 100): Promise<number> {
    this.sweeping ??= this.runSweep(limit).finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async runSweep(limit: number): Promise<number> {
    let published = 0;
    for (const entry of await this.deps.outbox.pending(limit)) if (await this.deliver(entry)) published++;
    return published;
  }
}
