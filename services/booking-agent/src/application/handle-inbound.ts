// Caso de uso central: uma mensagem do aluno entra, a conversa decide se o bot fala, o agente
// responde e as saídas são publicadas.
import { randomUUID } from 'node:crypto';
import { Conversation } from '../domain/conversation.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import { OutboxRelay } from './outbox-relay.js';
import { botEntries, citationsOf, handoffEntry, studentEntry } from './timeline.js';
import type {
  Clock,
  ConversationLog,
  ConversationAgent,
  ConversationRepository,
  HandoffQueue,
  HandoffTicket,
  InboundCommand,
  Outbox,
  OutboxEntry,
  OutboundMessage,
  OutboundPublisher,
  TurnOutcome,
} from './ports.js';

export type HandleResult = TurnOutcome | 'duplicate' | 'silenced';

export interface HandleInboundDeps {
  readonly conversations: ConversationRepository;
  readonly agent: ConversationAgent;
  readonly publisher: OutboundPublisher;
  readonly outbox: Outbox;
  /** Chamado quando a publicação imediata falha; o varredor da caixa de saída tenta de novo. */
  readonly onPublishError?: (error: unknown) => void;
  readonly handoffs: HandoffQueue;
  readonly log: ConversationLog;
  readonly metrics: MetricsRecorder;
  readonly clock: Clock;
}

export class HandleInboundMessage {
  private readonly relay: OutboxRelay;

  constructor(private readonly deps: HandleInboundDeps) {
    this.relay = new OutboxRelay({ outbox: deps.outbox, publisher: deps.publisher, ...(deps.onPublishError ? { onError: deps.onPublishError } : {}) });
  }

  async execute(command: InboundCommand): Promise<HandleResult> {
    const { conversations, agent, handoffs, log, metrics, clock } = this.deps;
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

    // Outbox (ADR 0014): a conversa e as saídas são gravadas juntas, de uma vez. Cair antes não grava nada (a
    // reentrega refaz o turno); cair depois deixa as saídas na caixa para o varredor publicar. Conflito de
    // versão também não publica nada, ao contrário do antigo "publicar e depois salvar".
    const entry: OutboxEntry | undefined = outbound.length > 0 ? { id: randomUUID(), correlationId: command.messageId, messages: outbound } : undefined;
    for (const ticket of tickets) await handoffs.enqueue(ticket);
    await conversations.save(conversation, entry);
    if (entry) await this.relay.deliver(entry);

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
