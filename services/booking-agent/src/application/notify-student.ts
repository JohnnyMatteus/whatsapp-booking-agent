// Aviso proativo por template (lembrete de aula, vaga liberada da lista de espera).
//
// Antes de enviar, confere na agenda (ferramenta) que a reserva está confirmada: o template só
// cita data e hora que vieram dessa consulta. Um aviso sai uma única vez por reserva e tipo.
import { randomUUID } from 'node:crypto';
import { uncitedMentions } from '../agent/citation-guard.js';
import { formatSlotStart, localDate } from '../agent/format.js';
import { Conversation, type OfferedSlot } from '../domain/conversation.js';
import { DomainError } from '../domain/errors.js';
import type { MetricsRecorder } from './metrics-recorder.js';
import type { Clock, ConversationLog, ConversationRepository, NoticeLedger, OutboundPublisher, Reply, SchedulingTools, TemplateName } from './ports.js';
import { citationsOf } from './timeline.js';

export type NoticeKind = 'reminder' | 'promotion';
const TEMPLATE_OF: Record<NoticeKind, TemplateName> = { reminder: 'lembrete_aula', promotion: 'vaga_liberada' };

const PREVIEW: Record<TemplateName, (title: string, when: string) => string> = {
  lembrete_aula: (title, when) => `Lembrete: sua aula ${title} é ${when}.`,
  vaga_liberada: (title, when) => `Vaga liberada: você entrou em ${title} (${when}).`,
};

export interface NoticeRequest {
  readonly tenantId: string;
  readonly contactId: string;
  readonly kind: NoticeKind;
  readonly sessionId: string;
  /** Dia local da aula (AAAA-MM-DD), para consultar a grade do dia. */
  readonly date: string;
}

export type NoticeResult = 'sent' | 'already_sent';

export class NotifyStudent {
  constructor(
    private readonly deps: {
      tools: SchedulingTools;
      conversations: ConversationRepository;
      publisher: OutboundPublisher;
      log: ConversationLog;
      metrics: MetricsRecorder;
      ledger: NoticeLedger;
      clock: Clock;
      timezone: string;
    },
  ) {}

  async execute(request: NoticeRequest): Promise<NoticeResult> {
    const { tools, conversations, publisher, log, metrics, ledger, clock } = this.deps;
    const member = { tenantId: request.tenantId, contactId: request.contactId };
    const now = clock.now();

    const listing = await tools.listSessions(member, { from: request.date, to: request.date });
    const item = listing.find((l) => l.session.toProps().id === request.sessionId);
    if (!item?.myBooking || item.myBooking.status !== 'confirmed') {
      throw new DomainError('not_found', 'O aluno não tem reserva confirmada nesta aula.');
    }
    if (item.session.hasStartedAt(now)) throw new DomainError('class_session_started', 'A aula já começou.');

    if (!(await ledger.claim(`${request.kind}:${request.tenantId}:${item.myBooking.id}`))) return 'already_sent';

    const props = item.session.toProps();
    const slot: OfferedSlot = {
      sessionId: props.id,
      title: props.title,
      instructorName: props.instructorName,
      startsAt: props.startsAt.toISOString(),
      endsAt: props.endsAt.toISOString(),
      timezone: props.timezone,
      capacity: props.capacity,
      confirmedCount: props.confirmedCount,
      waitlistCount: props.waitlistCount,
      booking: item.myBooking,
    };
    const when = formatSlotStart(slot.startsAt, slot.timezone);
    const template = TEMPLATE_OF[request.kind];
    const reply: Reply = { kind: 'template', template, params: [slot.title, when] };
    if (uncitedMentions(reply, [slot]).length > 0) throw new DomainError('invalid_request', 'Template com data fora da consulta.');

    await publisher.publish([{ kind: 'reply', member, reply }], `notice-${randomUUID()}`);

    const conversation =
      (await conversations.load(request.tenantId, request.contactId)) ?? Conversation.start({ tenantId: request.tenantId, contactId: request.contactId });
    conversation.markLinked(true);
    await conversations.save(conversation);
    await log.record(conversation, [
      { id: randomUUID(), at: now.toISOString(), kind: 'template', template, text: PREVIEW[template](slot.title, when), citations: citationsOf([slot], now.toISOString()) },
    ]);
    await metrics.proactive(request.tenantId, request.kind, now);
    return 'sent';
  }

  /** Dia local da aula no fuso do estúdio, para quem só tem o instante. */
  dayOf(startsAt: string): string {
    return localDate(new Date(startsAt), this.deps.timezone);
  }
}
