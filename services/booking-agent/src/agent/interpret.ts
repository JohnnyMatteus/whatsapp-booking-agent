// Interpretação por LLM, usada só quando a política determinística não decide.
// O schema é montado por turno: o LLM só pode apontar uma aula que foi oferecida.
import { z } from 'zod';
import type { OfferedSlot } from '../domain/conversation.js';
import { formatSlotStart } from './format.js';
import { generateStructured, type LlmClient } from './llm.js';

export const LlmIntent = z.enum(['list_slots', 'book', 'cancel', 'join_waitlist', 'greeting', 'out_of_scope', 'human']);
export type LlmIntent = z.infer<typeof LlmIntent>;

const Interpretation = z.object({
  intent: LlmIntent,
  sessionId: z.string().nullable().default(null),
  day: z.iso.date().nullable().default(null),
});
export type Interpretation = z.infer<typeof Interpretation>;

const SYSTEM = [
  'Você classifica mensagens de alunos de um estúdio de yoga e pilates no WhatsApp.',
  'O assistente só trata de aulas e reservas. Qualquer outro assunto é "out_of_scope".',
  'Se o aluno pedir uma pessoa, use "human".',
  'Responda somente JSON: {"intent": <intenção>, "sessionId": <id de uma aula oferecida ou null>, "day": <AAAA-MM-DD ou null>}.',
  'Nunca invente id de aula: use apenas ids da lista de aulas oferecidas.',
].join('\n');

export async function interpret(
  llm: LlmClient,
  text: string,
  offered: readonly OfferedSlot[],
  today: string,
): Promise<Interpretation> {
  const offeredList =
    offered.length === 0
      ? 'Nenhuma aula oferecida ainda.'
      : offered.map((s) => `- id=${s.sessionId}: ${s.title}, ${formatSlotStart(s.startsAt, s.timezone)}`).join('\n');
  const offeredIds = new Set(offered.map((s) => s.sessionId));

  return generateStructured(
    llm,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Hoje é ${today}.\nAulas oferecidas:\n${offeredList}\n\nMensagem do aluno: """${text}"""` },
    ],
    Interpretation,
    (value) => (value.sessionId !== null && !offeredIds.has(value.sessionId) ? [`sessionId ${value.sessionId} não foi oferecido`] : []),
  );
}
