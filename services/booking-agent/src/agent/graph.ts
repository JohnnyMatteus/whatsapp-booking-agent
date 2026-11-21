// Grafo LangGraph do agente de agendamento (adapter de aplicação, ADR 0001).
//
//   START → screen ─┬─ handoff ───────────────┐
//                   ├─ refuse ────────────────┤
//                   ├─ interpret ─┬─ act ─┬─ compose ─┤
//                   │             │       ├───────────┤→ finalize → END
//                   └─ act ───────┘       └─ fail ────┘
//
// O LLM nunca chama ferramentas: ele só classifica (interpret) e escreve uma frase de abertura
// (compose). Quem chama as ferramentas é o código do nó `act`, com a identidade do aluno
// vinda da conversa, nunca do modelo.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AgentResult, Clock, ConversationAgent, DateRange, Reply, SchedulingTools, Turn, TurnOutcome } from '../application/ports.js';
import { Booking } from '../domain/booking.js';
import { sessionOf, type Conversation, type OfferedSlot } from '../domain/conversation.js';
import { isDomainError } from '../domain/errors.js';
import type { HandoffReason } from '../domain/events.js';
import { classifyScope, type Intent } from '../domain/scope-policy.js';
import { Waitlist } from '../domain/waitlist.js';
import { uncitedMentions } from './citation-guard.js';
import { composeIntro } from './compose.js';
import { dateRangeFor, dateRangeForIsoDay } from './date-range.js';
import { localDate } from './format.js';
import { interpret } from './interpret.js';
import { LlmOutputInvalid, type LlmClient } from './llm.js';
import { FALLBACK_INTRO, replies } from './replies.js';

export type Step = 'interpret' | 'act' | 'compose' | 'refuse' | 'handoff' | 'fail' | 'finalize';
type Failure = 'not_understood' | 'unavailable';

export interface AgentObserver {
  /** Chamado uma vez por turno com o caminho percorrido (métricas e traces). */
  turnFinished(info: { outcome: TurnOutcome; steps: readonly string[]; citationViolations: number }): void;
  /** Saída do LLM rejeitada mesmo depois do retry. */
  llmRejected(stage: 'interpret' | 'compose', issues: readonly string[]): void;
}

export interface AgentDeps {
  readonly tools: SchedulingTools;
  readonly llm: LlmClient;
  readonly clock: Clock;
  /** Fuso usado para interpretar "hoje"/"amanhã" antes de consultar a agenda. */
  readonly timezone: string;
  readonly observer?: AgentObserver;
}

const value = <T>(initial: () => T) => Annotation<T>({ reducer: (_current, next) => next, default: initial });

const AgentState = Annotation.Root({
  conversation: Annotation<Conversation>,
  turn: Annotation<Turn>,
  intent: value<Intent | null>(() => null),
  targetId: value<string | null>(() => null),
  range: value<DateRange | null>(() => null),
  /** Aulas devolvidas pelas ferramentas neste turno. */
  slots: value<readonly OfferedSlot[]>(() => []),
  replies: value<readonly Reply[]>(() => []),
  handoffReason: value<HandoffReason | null>(() => null),
  failure: value<Failure | null>(() => null),
  outcome: value<TurnOutcome>(() => 'answered'),
  next: value<Step>(() => 'finalize'),
  steps: value<readonly string[]>(() => []),
});
type State = typeof AgentState.State;
type Update = typeof AgentState.Update;

/** Limite de linhas de uma lista interativa da Cloud API. */
const MAX_CHOICES = 10;
const ACTION_INTENT = { book: 'book', cancel: 'cancel', waitlist: 'join_waitlist' } as const;

export function buildAgentGraph(deps: AgentDeps) {
  const { tools, llm, clock, timezone } = deps;
  const member = (state: State) => ({ tenantId: state.conversation.tenantId, contactId: state.conversation.contactId });
  const textOf = (turn: Turn) => (turn.kind === 'text' ? turn.text : '');
  const trail = (state: State, step: string) => [...state.steps, step];

  const screen = async (state: State): Promise<Update> => {
    const { turn } = state;
    const steps = trail(state, 'screen');
    if (turn.kind === 'unsupported') return { steps, replies: [replies.unsupported()], next: 'finalize' };
    if (turn.kind === 'action') return { steps, intent: ACTION_INTENT[turn.action], targetId: turn.targetId, next: 'act' };

    const verdict = classifyScope(turn.text);
    switch (verdict.kind) {
      case 'handoff':
        return { steps, handoffReason: verdict.reason, next: 'handoff' };
      case 'out_of_scope':
        return { steps, next: 'refuse' };
      case 'in_scope':
        return { steps, intent: verdict.intent, range: dateRangeFor(turn.text, clock.now(), timezone), next: 'act' };
      case 'undecided':
        return { steps, next: 'interpret' };
    }
  };

  const interpretStep = async (state: State): Promise<Update> => {
    const steps = trail(state, 'interpret');
    const now = clock.now();
    try {
      const result = await interpret(llm, textOf(state.turn), state.conversation.currentOffer(now), localDate(now, timezone));
      if (result.intent === 'out_of_scope') return { steps, next: 'refuse' };
      if (result.intent === 'human') return { steps, handoffReason: 'explicit_request', next: 'handoff' };
      const range = result.day ? dateRangeForIsoDay(result.day) : dateRangeFor(textOf(state.turn), now, timezone);
      return { steps, intent: result.intent, targetId: result.sessionId, range, next: 'act' };
    } catch (error) {
      if (!(error instanceof LlmOutputInvalid)) throw error;
      deps.observer?.llmRejected('interpret', error.issues);
      return { steps, failure: 'not_understood', next: 'fail' };
    }
  };

  const act = async (state: State): Promise<Update> => {
    const steps = trail(state, 'act');
    const { conversation, targetId } = state;
    const now = clock.now();
    const range = state.range ?? dateRangeFor('', now, timezone);

    /** Consulta a agenda e guarda como oferta só o que o aluno vai ver (no máximo 10 opções). */
    const listOffers = async (alreadyBooked: boolean) => {
      const listing = await tools.listSessions(member(state), range);
      const offers = listing
        .filter((item) => !item.session.hasStartedAt(now) && (item.myBooking !== null) === alreadyBooked)
        .slice(0, MAX_CHOICES)
        .map((item) => ({ session: item.session, booking: item.myBooking }));
      return conversation.offerSlots(offers, now);
    };

    try {
      let update: Update;
      switch (state.intent) {
        case 'greeting':
          update = { replies: [replies.greeting()], next: 'finalize' };
          break;
        case 'list_slots':
          update = await offerToBook();
          break;
        case 'book':
          update = targetId ? await book(targetId) : await offerToBook();
          break;
        case 'join_waitlist':
          update = targetId ? await joinWaitlist(targetId) : await offerToBook();
          break;
        case 'cancel':
          update = targetId ? await cancel(targetId) : await offerCancellation();
          break;
        case null:
          update = { failure: 'not_understood', next: 'fail' };
          break;
      }
      if (update.next !== 'fail') conversation.recordSuccess();
      return { steps, ...update };
    } catch (error) {
      if (isDomainError(error) && !error.retryable) {
        conversation.recordSuccess();
        return { steps, replies: [replies.businessRejection(error.code)], next: 'finalize' };
      }
      return { steps, failure: 'unavailable', next: 'fail' };
    }

    async function offerToBook(): Promise<Update> {
      const slots = await listOffers(false);
      return slots.length === 0 ? { replies: [replies.noSlots()], next: 'finalize' } : { slots, next: 'compose' };
    }

    async function offerCancellation(): Promise<Update> {
      const slots = await listOffers(true);
      return slots.length === 0
        ? { replies: [replies.noBookings()], next: 'finalize' }
        : { slots, replies: [replies.cancellationChoices(slots)], next: 'finalize' };
    }

    async function book(sessionId: string): Promise<Update> {
      const slot = conversation.offeredSlot(sessionId, now);
      if (sessionOf(slot).bookingOutcomeAt(now) === 'waitlist') return { replies: [replies.offerWaitlist(slot)], next: 'finalize' };
      const booking = await tools.book(member(state), sessionId);
      return { replies: [booking.status === 'waitlisted' ? replies.bookedIntoWaitlist(slot) : replies.booked(slot)], next: 'finalize' };
    }

    async function joinWaitlist(sessionId: string): Promise<Update> {
      const slot = conversation.offeredSlot(sessionId, now);
      const session = sessionOf(slot);
      const { position } = Waitlist.of(session, slot.booking?.status === 'waitlisted').join(session, now, slot.booking?.status === 'confirmed');
      const booking = await tools.joinWaitlist(member(state), sessionId);
      return { replies: [booking.status === 'confirmed' ? replies.booked(slot) : replies.joinedWaitlist(slot, position)], next: 'finalize' };
    }

    async function cancel(bookingId: string): Promise<Update> {
      const slot = conversation.offeredBooking(bookingId, now);
      // Pré-validação local: evita ida ao SaaS para o que o domínio já sabe recusar.
      Booking.create({ id: bookingId, sessionId: slot.sessionId, status: slot.booking?.status ?? 'confirmed' }).cancel(sessionOf(slot), now);
      const outcome = await tools.cancel(member(state), bookingId);
      return { replies: [replies.canceled(slot, outcome.freedSeat)], next: 'finalize' };
    }
  };

  const compose = async (state: State): Promise<Update> => {
    const steps = trail(state, 'compose');
    try {
      const intro = await composeIntro(llm, textOf(state.turn), state.slots);
      const highlighted = new Set(intro.highlightedSessionIds);
      const ordered = [...state.slots].sort((a, b) => Number(highlighted.has(b.sessionId)) - Number(highlighted.has(a.sessionId)));
      return { steps, replies: [replies.slotChoices(intro.text, ordered)], next: 'finalize' };
    } catch (error) {
      if (!(error instanceof LlmOutputInvalid)) throw error;
      // A lista já está correta; só a frase de abertura cai para o texto fixo.
      deps.observer?.llmRejected('compose', error.issues);
      return { steps, replies: [replies.slotChoices(FALLBACK_INTRO, state.slots)], next: 'finalize' };
    }
  };

  const refuse = async (state: State): Promise<Update> => ({
    steps: trail(state, 'refuse'),
    replies: [replies.refusal()],
    outcome: 'refused',
    next: 'finalize',
  });

  const handoff = async (state: State): Promise<Update> => {
    const reason = state.handoffReason ?? 'explicit_request';
    state.conversation.handOff(reason, clock.now());
    return { steps: trail(state, 'handoff'), replies: [replies.handoff(reason)], outcome: 'handed_off', next: 'finalize' };
  };

  const fail = async (state: State): Promise<Update> => {
    const steps = trail(state, 'fail');
    if (state.conversation.recordFailure(clock.now()) === 'handed_off') {
      return { steps, replies: [replies.handoff('repeated_failure')], outcome: 'handed_off', next: 'finalize' };
    }
    const reply = state.failure === 'unavailable' ? replies.temporarilyUnavailable() : replies.didNotUnderstand();
    return { steps, replies: [reply], outcome: 'failed', next: 'finalize' };
  };

  const finalize = async (state: State): Promise<Update> => {
    const allowed = [...state.slots, ...state.conversation.currentOffer(clock.now())];
    let violations = 0;
    const safe = state.replies.map((reply) => {
      if (uncitedMentions(reply, allowed).length === 0) return reply;
      violations++;
      return replies.didNotUnderstand();
    });
    const steps = trail(state, 'finalize');
    deps.observer?.turnFinished({ outcome: state.outcome, steps, citationViolations: violations });
    return { steps, replies: safe };
  };

  const route = (state: State) => state.next;

  return new StateGraph(AgentState)
    .addNode('screen', screen)
    .addNode('interpret', interpretStep)
    .addNode('act', act)
    .addNode('compose', compose)
    .addNode('refuse', refuse)
    .addNode('handoff', handoff)
    .addNode('fail', fail)
    .addNode('finalize', finalize)
    .addEdge(START, 'screen')
    .addConditionalEdges('screen', route, ['interpret', 'act', 'refuse', 'handoff', 'finalize'])
    .addConditionalEdges('interpret', route, ['act', 'refuse', 'handoff', 'fail'])
    .addConditionalEdges('act', route, ['compose', 'fail', 'finalize'])
    .addEdge('compose', 'finalize')
    .addEdge('refuse', 'finalize')
    .addEdge('handoff', 'finalize')
    .addEdge('fail', 'finalize')
    .addEdge('finalize', END)
    .compile();
}

/** Implementa a porta ConversationAgent sobre o grafo. */
export class LangGraphConversationAgent implements ConversationAgent {
  private readonly graph: ReturnType<typeof buildAgentGraph>;

  constructor(deps: AgentDeps) {
    this.graph = buildAgentGraph(deps);
  }

  async respond(conversation: Conversation, turn: Turn): Promise<AgentResult> {
    const final = await this.graph.invoke({ conversation, turn });
    return { replies: final.replies, outcome: final.outcome };
  }
}
