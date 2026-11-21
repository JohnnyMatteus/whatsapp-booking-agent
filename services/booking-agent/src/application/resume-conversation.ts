// O atendente encerra o atendimento e devolve a conversa ao bot (ação do painel).
import { DomainError } from '../domain/errors.js';
import type { Clock, ConversationRepository, HandoffQueue } from './ports.js';

export class ResumeConversation {
  constructor(
    private readonly deps: { conversations: ConversationRepository; handoffs: HandoffQueue; clock: Clock },
  ) {}

  async execute(tenantId: string, contactId: string): Promise<void> {
    const conversation = await this.deps.conversations.load(tenantId, contactId);
    if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada.');
    conversation.resumeBot(this.deps.clock.now());
    conversation.pullEvents();
    await this.deps.conversations.save(conversation);
    await this.deps.handoffs.remove(tenantId, conversation.id);
  }
}
