// O atendente encerra o atendimento e devolve a conversa ao bot (ação do painel).
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import type { Clock, ConversationLog, ConversationRepository, HandoffQueue, OutboundPublisher } from './ports.js';
import { resumedEntry } from './timeline.js';

export const RESUME_NOTICE = 'Voltei a atender por aqui. Posso mostrar os horários das aulas, reservar, cancelar ou colocar você na lista de espera.';

export class ResumeConversation {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      handoffs: HandoffQueue;
      publisher: OutboundPublisher;
      log: ConversationLog;
      metrics: MetricsRecorder;
      clock: Clock;
    },
  ) {}

  async execute(tenantId: string, contactId: string): Promise<void> {
    const { conversations, handoffs, publisher, log, clock } = this.deps;
    const conversation = await conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    const now = clock.now();
    conversation.resumeBot(now);
    conversation.pullEvents();
    // Aviso ao aluno antes de salvar, como no resto: na dúvida, melhor duplicar que silenciar.
    await publisher.publish([{ kind: 'reply', member: { tenantId, contactId }, reply: { kind: 'text', text: RESUME_NOTICE } }], `resume-${randomUUID()}`);
    await conversations.save(conversation);
    await handoffs.remove(tenantId, conversation.id);
    await log.record(conversation, [resumedEntry(now)]);
  }
}
