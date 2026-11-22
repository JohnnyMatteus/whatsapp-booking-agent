// Política de escopo em forma de leitura para a tela "Escopo e respostas" (só leitura).
import { replies } from '../agent/replies.js';
import type { Intent } from '../domain/scope-policy.js';
import type { HandoffReason } from '../domain/events.js';

const INTENTS: readonly { intent: Intent; label: string; examples: readonly string[] }[] = [
  { intent: 'list_slots', label: 'Ver horários', examples: ['quais horários tem amanhã?', 'tem aula de pilates na quarta?'] },
  { intent: 'book', label: 'Reservar', examples: ['quero reservar a aula das 18h', 'me inscreve na de yoga'] },
  { intent: 'cancel', label: 'Cancelar reserva', examples: ['cancela minha aula de quinta', 'não vou poder ir'] },
  { intent: 'join_waitlist', label: 'Lista de espera', examples: ['me coloca na fila de espera', 'me avisa se abrir vaga'] },
  { intent: 'greeting', label: 'Saudação e menu', examples: ['oi', 'bom dia', 'menu'] },
];

const HANDOFF: readonly { reason: HandoffReason; label: string; examples: readonly string[] }[] = [
  { reason: 'explicit_request', label: 'Pedido de atendente', examples: ['quero falar com a recepção', 'chama uma pessoa de verdade'] },
  { reason: 'sensitive_topic', label: 'Tema sensível', examples: ['estou com dor no joelho', 'quero reembolso da mensalidade'] },
  { reason: 'repeated_failure', label: 'Duas falhas seguidas', examples: ['mensagens que o bot não consegue entender duas vezes em seguida'] },
];

export function scopeInfo() {
  const refusal = replies.refusal();
  return {
    intents: INTENTS.map((i) => ({ ...i })),
    handoffTriggers: HANDOFF.map((h) => ({ ...h })),
    outOfScopeExamples: ['me conta uma piada', 'qual a previsão do tempo?', 'escreve um código em python'],
    refusal: refusal.kind === 'text' ? refusal.text : '',
  };
}
