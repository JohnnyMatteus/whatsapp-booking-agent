// Frase de abertura de uma lista de horários, escrita pelo LLM sob duas regras checadas por
// código: nada de data ou hora no texto, e só ids de aulas devolvidas pelas ferramentas.
import { z } from 'zod';
import type { OfferedSlot } from '../domain/conversation.js';
import { llmTextIssues } from './citation-guard.js';
import { generateStructured, type LlmClient } from './llm.js';

const Intro = z.object({
  text: z.string().min(1).max(300),
  highlightedSessionIds: z.array(z.string()).max(10).default([]),
});
export type Intro = z.infer<typeof Intro>;

const SYSTEM = [
  'Você escreve uma frase curta e cordial, em português do Brasil, que abre uma lista de aulas.',
  'Não escreva datas, dias do mês nem horários: o sistema mostra os horários abaixo da frase.',
  'Se quiser destacar aulas, use apenas ids da lista recebida em "highlightedSessionIds".',
  'Responda somente JSON: {"text": <frase>, "highlightedSessionIds": [<ids>]}.',
].join('\n');

export async function composeIntro(llm: LlmClient, request: string, slots: readonly OfferedSlot[]): Promise<Intro> {
  const ids = new Set(slots.map((s) => s.sessionId));
  return generateStructured(
    llm,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Pedido do aluno: """${request}"""\nAulas: ${slots.map((s) => `${s.sessionId} (${s.title})`).join(', ')}` },
    ],
    Intro,
    (intro) => [
      ...llmTextIssues(intro.text),
      ...intro.highlightedSessionIds.filter((id) => !ids.has(id)).map((id) => `id ${id} não veio das ferramentas`),
    ],
  );
}
