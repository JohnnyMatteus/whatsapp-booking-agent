// Respostas determinísticas. Toda hora citada vem de um OfferedSlot (dado das ferramentas)
// formatado por format.ts; nenhum template recebe hora digitada pelo aluno ou pelo LLM.
import type { Choice, Reply } from '../application/ports.js';
import { sessionOf, type OfferedSlot } from '../domain/conversation.js';
import type { DomainErrorCode } from '../domain/errors.js';
import type { HandoffReason } from '../domain/events.js';
import { formatSlotStart } from './format.js';

const text = (value: string): Reply => ({ kind: 'text', text: value });
const when = (slot: OfferedSlot) => formatSlotStart(slot.startsAt, slot.timezone);

export const MENU_HINT = 'Posso mostrar os horários das aulas, reservar, cancelar uma reserva ou colocar você na lista de espera.';

export const replies = {
  greeting: () => text(`Olá! Sou o assistente de agendamento do estúdio. ${MENU_HINT}`),

  refusal: () =>
    text(`Desculpe, só consigo ajudar com aulas e reservas do estúdio. ${MENU_HINT}`),

  unsupported: () => text('Por aqui eu entendo mensagens de texto e de áudio. Pode me escrever o que precisa?'),

  handoff: (reason: HandoffReason) =>
    text(
      reason === 'repeated_failure'
        ? 'Não consegui resolver por aqui. Vou passar sua conversa para alguém da equipe, que responde em breve.'
        : 'Vou passar sua conversa para alguém da equipe do estúdio, que responde em breve.',
    ),

  didNotUnderstand: () => text(`Não entendi bem. ${MENU_HINT}`),

  temporarilyUnavailable: () => text('A agenda do estúdio está indisponível agora. Pode tentar de novo em alguns minutos?'),

  linked: (name: string) => text(`Pronto, ${name}! Seu telefone está vinculado. ${MENU_HINT}`),

  noSlots: () => text('Não encontrei aulas com vaga nesse período. Quer que eu procure em outro dia?'),

  noBookings: () => text('Não encontrei reservas suas nos próximos dias.'),

  booked: (slot: OfferedSlot) => text(`Pronto! Sua vaga em ${slot.title} (${when(slot)}) está confirmada.`),

  bookedIntoWaitlist: (slot: OfferedSlot) =>
    text(`A última vaga de ${slot.title} (${when(slot)}) acabou agora, então você entrou na lista de espera.`),

  canceled: (slot: OfferedSlot, freedSeat: boolean) =>
    text(`Reserva cancelada: ${slot.title} (${when(slot)}).${freedSeat ? ' Obrigado por liberar a vaga!' : ''}`),

  joinedWaitlist: (slot: OfferedSlot, position: number) =>
    text(`Você entrou na lista de espera de ${slot.title} (${when(slot)}). Sua posição agora: ${String(position)}.`),

  offerWaitlist: (slot: OfferedSlot): Reply => ({
    kind: 'choices',
    body: `${slot.title} (${when(slot)}) está lotada. Quer entrar na lista de espera?`,
    choices: [{ action: 'waitlist', targetId: slot.sessionId, title: 'Entrar na fila', description: slot.title }],
  }),

  cancellationChoices: (slots: readonly OfferedSlot[]): Reply => ({
    kind: 'choices',
    body: 'Qual reserva você quer cancelar?',
    choices: slots.flatMap((slot) => (slot.booking ? [{ action: 'cancel' as const, targetId: slot.booking.id, title: slot.title, description: when(slot) }] : [])),
  }),

  slotChoices: (body: string, slots: readonly OfferedSlot[]): Reply => ({ kind: 'choices', body, choices: slots.map(slotChoice) }),

  /** Recusa de regra de negócio: o bot respondeu certo, então não conta como falha. */
  businessRejection: (code: DomainErrorCode): Reply => text(BUSINESS_MESSAGES[code] ?? 'Não foi possível concluir o pedido.'),
};

export const FALLBACK_INTRO = 'Estas são as aulas que encontrei. Toque em uma para continuar.';

function slotChoice(slot: OfferedSlot): Choice {
  const full = sessionOf(slot).isFull();
  const situation = full ? `lotada, fila ${String(slot.waitlistCount)}` : 'com vaga';
  return full
    ? { action: 'waitlist', targetId: slot.sessionId, title: slot.title, description: `${when(slot)} · ${situation}` }
    : { action: 'book', targetId: slot.sessionId, title: slot.title, description: `${when(slot)} · ${situation}` };
}

const BUSINESS_MESSAGES: Partial<Record<DomainErrorCode, string>> = {
  class_session_started: 'Essa aula já começou, então não dá mais para alterar a reserva.',
  class_session_full: 'Essa aula lotou. Posso colocar você na lista de espera.',
  seats_available: 'Essa aula ainda tem vaga, então dá para reservar direto.',
  already_booked: 'Você já tem reserva nessa aula.',
  overlapping_booking: 'Você já tem outra aula nesse mesmo horário.',
  booking_already_canceled: 'Essa reserva já estava cancelada.',
  cancellation_window_closed: 'O prazo para cancelar essa aula já passou. Se precisar, fale com a recepção.',
  already_in_waitlist: 'Você já está na lista de espera dessa aula.',
  slot_not_offered: 'Essa opção expirou. Vou mostrar os horários atualizados se você pedir "horários".',
  not_found: 'Não encontrei essa aula ou reserva. Ela pode ter sido removida pelo estúdio.',
  access_denied: 'Não encontrei seu cadastro no estúdio. Fale com a recepção para liberar o agendamento.',
  contact_not_linked:
    'Este telefone ainda não está vinculado ao seu cadastro. Entre na sua conta do estúdio, gere o código em "Meu perfil > WhatsApp" e me envie: vincular 123456 (com o seu código).',
  invalid_link_code: 'Esse código não é válido ou já expirou. Gere um novo na sua conta do estúdio e me envie: vincular 123456 (com o seu código).',
};
