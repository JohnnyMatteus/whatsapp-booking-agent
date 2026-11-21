// Caso de uso central: uma mensagem do aluno entra, a conversa decide se o bot fala, o agente
// responde e as saídas são publicadas.
import { Conversation } from '../domain/conversation.js';
import type {
  Clock,
  ConversationAgent,
  ConversationRepository,
  HandoffQueue,
  HandoffTicket,
  InboundCommand,
  OutboundMessage,
  OutboundPublisher,
  TurnOutcome,
} from './ports.js';

export type HandleResult = TurnOutcome | 'duplicate' | 'silenced';

export interface HandleInboundDeps {
  readonly conversations: ConversationRepository;
  readonly agent: ConversationAgent;
  readonly publisher: OutboundPublisher;
  readonly handoffs: HandoffQueue;
  readonly clock: Clock;
}

export class HandleInboundMessage {
  constructor(private readonly deps: HandleInboundDeps) {}

  async execute(command: InboundCommand): Promise<HandleResult> {
    const { conversations, agent, publisher, handoffs } = this.deps;
    const conversation =
      (await conversations.load(command.tenantId, command.contactId)) ??
      Conversation.start({ tenantId: command.tenantId, contactId: command.contactId });

    const reception = conversation.receive(command.messageId);
    if (reception === 'duplicate') return 'duplicate';
    if (reception === 'silenced') {
      // Com a conversa num humano, o bot só registra que a mensagem chegou.
      await conversations.save(conversation);
      return 'silenced';
    }

    const result = await agent.respond(conversation, command.turn);
    const tickets = this.handoffTickets(conversation);
    const outbound: OutboundMessage[] = [
      ...result.replies.map((reply): OutboundMessage => ({ kind: 'reply', member: command, inReplyTo: command.messageId, reply })),
      ...tickets.map((ticket): OutboundMessage => ({ kind: 'handoff', ticket })),
    ];

    // Publica antes de salvar: se cair no meio, a reentrega responde de novo (duplicata rara)
    // em vez de perder a resposta. Trade-off e alternativa (outbox) no ADR 0005.
    await publisher.publish(outbound, command.messageId);
    for (const ticket of tickets) await handoffs.enqueue(ticket);
    await conversations.save(conversation);
    return result.outcome;
  }

  private handoffTickets(conversation: Conversation): HandoffTicket[] {
    return conversation.pullEvents().flatMap((event) =>
      event.type === 'handoff_requested'
        ? [
            {
              tenantId: conversation.tenantId,
              conversationId: conversation.id,
              contactId: conversation.contactId,
              reason: event.reason,
              requestedAt: event.at.toISOString(),
            },
          ]
        : [],
    );
  }
}
