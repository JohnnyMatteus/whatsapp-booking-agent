// Caso de uso central: uma mensagem do aluno entra, a conversa decide se o bot fala, o agente
// responde e as saídas são publicadas.
import { Conversation } from '../domain/conversation.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import { botEntries, citationsOf, handoffEntry, studentEntry } from './timeline.js';
import type {
  Clock,
  ConversationLog,
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
  readonly log: ConversationLog;
  readonly metrics: MetricsRecorder;
  readonly clock: Clock;
}

export class HandleInboundMessage {
  constructor(private readonly deps: HandleInboundDeps) {}

  async execute(command: InboundCommand): Promise<HandleResult> {
    const { conversations, agent, publisher, handoffs, log, metrics, clock } = this.deps;
    const now = clock.now();
    const conversation =
      (await conversations.load(command.tenantId, command.contactId)) ??
      Conversation.start({ tenantId: command.tenantId, contactId: command.contactId });

    const reception = conversation.receive(command.messageId);
    if (reception === 'duplicate') return 'duplicate';
    conversation.touchInbound(now);
    const student = studentEntry({ turn: command.turn, messageId: command.messageId, at: now, offer: conversation.currentOffer(now) });
    if (reception === 'silenced') {
      // Com a conversa num humano, o bot só registra que a mensagem chegou; o atendente a lê no painel.
      await conversations.save(conversation);
      await log.record(conversation, [student]);
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

    const fetchedAt = conversation.snapshot().offeredAt ?? now.toISOString();
    const entries = [
      student,
      ...botEntries({ replies: result.replies, outcome: result.outcome, citations: citationsOf(result.citations, fetchedAt), at: now }),
      ...tickets.map((ticket) => handoffEntry(ticket.reason, now)),
    ];
    await log.record(conversation, entries);
    await metrics.turn(command.tenantId, result.outcome, now);
    for (const ticket of tickets) await metrics.handoff(command.tenantId, ticket.reason, now);
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
