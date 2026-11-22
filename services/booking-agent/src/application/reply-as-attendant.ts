// O atendente responde ao aluno pelo painel; a mensagem sai pela Cloud API via sender.
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import type { Clock, ConversationLog, ConversationRepository, OutboundPublisher, TimelineEntry } from './ports.js';
import { attendantEntry } from './timeline.js';

export class ReplyAsAttendant {
  constructor(
    private readonly deps: { conversations: ConversationRepository; publisher: OutboundPublisher; log: ConversationLog; metrics: MetricsRecorder; clock: Clock },
  ) {}

  async execute(tenantId: string, contactId: string, text: string): Promise<TimelineEntry> {
    const { conversations, publisher, log, metrics, clock } = this.deps;
    const conversation = await conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    const now = clock.now();
    conversation.assertAttendantMayReply(now);
    const waitSeconds = conversation.attendantReplied(now);

    await publisher.publish([{ kind: 'reply', member: { tenantId, contactId }, reply: { kind: 'text', text } }], `attendant-${randomUUID()}`);
    await conversations.save(conversation);
    const entry = attendantEntry(text, now);
    await log.record(conversation, [entry]);
    if (waitSeconds !== null) await metrics.wait(tenantId, waitSeconds, now);
    return entry;
  }
}
