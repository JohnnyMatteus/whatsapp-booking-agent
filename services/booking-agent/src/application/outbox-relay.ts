// Publica as entradas da caixa de saída. O turno publica a sua própria entrada logo depois de salvar; o
// varredor publica o que sobrou (broker fora do ar, processo que caiu entre salvar e publicar).
// Entrega pelo menos uma vez: se a publicação passar e o `complete` falhar, a entrada sai de novo quando a
// reserva vencer. É a duplicata rara de sempre (ADR 0005), agora sem o caso de conflito de versão.
import type { Outbox, OutboxEntry, OutboundPublisher } from './ports.js';

export const OUTBOX_LEASE_SECONDS = 30;

export class OutboxRelay {
  constructor(
    private readonly deps: { outbox: Outbox; publisher: OutboundPublisher; onError?: (error: unknown) => void },
  ) {}

  /** true se esta chamada publicou a entrada. */
  async deliver(entry: OutboxEntry): Promise<boolean> {
    const { outbox, publisher, onError } = this.deps;
    if (!(await outbox.claim(entry.id, OUTBOX_LEASE_SECONDS))) return false;
    try {
      await publisher.publish(entry.messages, entry.correlationId);
      await outbox.complete(entry.id);
      return true;
    } catch (error) {
      onError?.(error);
      return false;
    }
  }

  /** Devolve quantas entradas publicou. */
  async sweep(limit = 100): Promise<number> {
    let published = 0;
    for (const entry of await this.deps.outbox.pending(limit)) if (await this.deliver(entry)) published++;
    return published;
  }
}
