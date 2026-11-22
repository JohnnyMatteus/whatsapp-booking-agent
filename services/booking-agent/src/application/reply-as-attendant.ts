// O atendente responde ao aluno pelo painel; a mensagem sai pela Cloud API via sender.
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import { OutboxRelay } from './outbox-relay.js';
import type { Clock, ConversationLog, ConversationRepository, Outbox, OutboundPublisher, TimelineEntry } from './ports.js';
import { attendantEntry } from './timeline.js';

export class ReplyAsAttendant {
  private readonly relay: OutboxRelay;

  constructor(
    private readonly deps: { conversations: ConversationRepository; publisher: OutboundPublisher; outbox: Outbox; log: ConversationLog; metrics: MetricsRecorder; clock: Clock },
  ) {
    this.relay = new OutboxRelay({ outbox: deps.outbox, publisher: deps.publisher });
  }

  async execute(tenantId: string, contactId: string, text: string): Promise<TimelineEntry> {
    const { conversations, log, metrics, clock } = this.deps;
    const conversation = await conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    const now = clock.now();
    conversation.assertAttendantMayReply(now);
    const waitSeconds = conversation.attendantReplied(now);

    // Salva e enfileira a saída juntas (ADR 0014); conflito de versão não envia nada e o painel pode repetir.
    const outboxEntry = { id: randomUUID(), correlationId: `attendant-${randomUUID()}`, messages: [{ kind: 'reply' as const, member: { tenantId, contactId }, reply: { kind: 'text' as const, text } }] };
    await conversations.save(conversation, outboxEntry);
    await this.relay.deliver(outboxEntry);
    const entry = attendantEntry(text, now);
    await log.record(conversation, [entry]);
    if (waitSeconds !== null) await metrics.wait(tenantId, waitSeconds, now);
    return entry;
  }
}
