// O atendente encerra o atendimento e devolve a conversa ao bot (ação do painel).
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import { OutboxRelay } from './outbox-relay.js';
import type { Clock, ConversationLog, ConversationRepository, HandoffQueue, Outbox, OutboundPublisher } from './ports.js';
import { resumedEntry } from './timeline.js';

export const RESUME_NOTICE = 'Voltei a atender por aqui. Posso mostrar os horários das aulas, reservar, cancelar ou colocar você na lista de espera.';

export class ResumeConversation {
  private readonly relay: OutboxRelay;

  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      handoffs: HandoffQueue;
      publisher: OutboundPublisher;
      outbox: Outbox;
      log: ConversationLog;
      metrics: MetricsRecorder;
      clock: Clock;
    },
  ) {
    this.relay = new OutboxRelay({ outbox: deps.outbox, publisher: deps.publisher });
  }

  async execute(tenantId: string, contactId: string): Promise<void> {
    const { conversations, handoffs, log, clock } = this.deps;
    const conversation = await conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    const now = clock.now();
    conversation.resumeBot(now);
    conversation.pullEvents();
    // O aviso ao aluno entra na caixa de saída na mesma gravação da conversa (ADR 0014).
    const entry = { id: randomUUID(), correlationId: `resume-${randomUUID()}`, messages: [{ kind: 'reply' as const, member: { tenantId, contactId }, reply: { kind: 'text' as const, text: RESUME_NOTICE } }] };
    await conversations.save(conversation, entry);
    await this.relay.deliver(entry);
    await handoffs.remove(tenantId, conversation.id);
    await log.record(conversation, [resumedEntry(now)]);
  }
}
