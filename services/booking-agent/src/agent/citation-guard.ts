// Garantia por código de que o bot só cita horários vindos das ferramentas.
//
// Duas barreiras:
// 1. O texto livre do LLM não pode conter nenhuma data ou hora (as horas são renderizadas
//    pelo código a partir dos dados das ferramentas).
// 2. Antes de publicar, toda resposta (inclusive os templates) é varrida: cada data ou hora
//    encontrada precisa pertencer a uma aula devolvida pelas ferramentas neste turno ou
//    oferecida na conversa. Se não pertencer, a resposta é trocada por uma mensagem segura.
import type { OfferedSlot } from '../domain/conversation.js';
import type { Reply } from '../application/ports.js';
import { citableTokens } from './format.js';

const TIME = /\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/gi;
const DATE = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\b/g;
const SPOKEN = /\b(meio[- ]dia|meia[- ]noite|\d{1,2}\s+(?:da|de)\s+(?:manh[ãa]|tarde|noite)|\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))\b/gi;

/** Expressões de data ou hora encontradas no texto, normalizadas para dd/mm e HH:mm. */
export function temporalMentions(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(TIME)) found.push(`${m[1]!.padStart(2, '0')}:${(m[2] ?? '00').padStart(2, '0')}`);
  for (const m of text.matchAll(DATE)) found.push(`${m[1]!.padStart(2, '0')}/${m[2]!.padStart(2, '0')}`);
  for (const m of text.matchAll(SPOKEN)) found.push(m[0].toLowerCase());
  return found;
}

/** Barreira 1: texto do LLM sem nenhuma menção temporal. */
export function llmTextIssues(text: string): string[] {
  const mentions = temporalMentions(text);
  return mentions.length === 0
    ? []
    : [`o texto não pode conter datas ou horários (${mentions.join(', ')}); eles são inseridos pelo sistema`];
}

/** Barreira 2: menções fora do conjunto permitido. Lista vazia = resposta segura. */
export function uncitedMentions(reply: Reply, allowed: readonly OfferedSlot[]): string[] {
  const permitted = new Set(
    allowed.flatMap((slot) => [...citableTokens(slot.startsAt, slot.timezone), ...citableTokens(slot.endsAt, slot.timezone)]),
  );
  // Títulos de aula vêm das ferramentas e podem ter números ("Yoga 1h"): saem da varredura.
  const titles = [...new Set(allowed.map((slot) => slot.title))].sort((a, b) => b.length - a.length);
  const withoutTitles = (value: string) => titles.reduce((acc, title) => acc.split(title).join(' '), value);
  const texts =
    reply.kind === 'text'
      ? [reply.text]
      : reply.kind === 'template'
        ? [...reply.params]
        : [reply.body, ...reply.choices.flatMap((c) => [c.title, c.description ?? ''])];
  return texts
    .map(withoutTitles)
    .flatMap(temporalMentions)
    .filter((mention) => !permitted.has(mention));
}
