// Tradutor de saída da ACL do Whatsmiau: resposta neutra do domínio → endpoint e corpo de envio.
// Mesmo protocolo de ids interativos da Cloud API: a escolha do aluno volta como o mesmo comando.
import type { Choice, ReplyRequested, TemplateName } from '@wba/contracts';
import { encodeChoiceId } from '../../../../domain/interactive-ids.js';
import { WHATSMIAU_LIMITS as L, type WhatsmiauOutbound } from '../whatsmiau-types.js';

export const LIST_BUTTON_LABEL = 'Ver opções';
export const LIST_SECTION_TITLE = 'Aulas';

/** Sem templates aprovados fora da Cloud API: os avisos viram texto com o mesmo conteúdo. */
const TEMPLATE_TEXT: Record<TemplateName, (title: string, when: string) => string> = {
  lembrete_aula: (title, when) => `Lembrete: sua aula ${title} é ${when}.`,
  vaga_liberada: (title, when) => `Vaga liberada: você entrou em ${title} (${when}).`,
};

export function translateReply(reply: ReplyRequested): WhatsmiauOutbound {
  const number = reply.contactId;
  const { content } = reply;

  if (content.kind === 'text') return { path: 'sendText', body: { number, text: truncate(content.text, L.text) } };

  if (content.kind === 'template') {
    const [title = '', when = ''] = content.params;
    return { path: 'sendText', body: { number, text: truncate(TEMPLATE_TEXT[content.template](title, when), L.text) } };
  }

  const description = truncate(content.body, L.body);
  const fitsButtons =
    content.choices.length <= L.buttons && content.choices.every((c) => c.description === undefined && c.title.length <= L.buttonTitle);
  if (fitsButtons) {
    return {
      path: 'sendButtons',
      body: { number, description, buttons: content.choices.map((c) => ({ type: 'reply', displayText: c.title, id: encodeChoiceId(c.action, c.targetId) })) },
    };
  }
  return {
    path: 'sendList',
    body: {
      number,
      description,
      buttonText: LIST_BUTTON_LABEL,
      sections: [{ title: LIST_SECTION_TITLE, rows: content.choices.slice(0, L.listRows).map(row) }],
    },
  };
}

function row(choice: Choice) {
  return {
    title: truncate(choice.title, L.rowTitle),
    rowId: encodeChoiceId(choice.action, choice.targetId),
    ...(choice.description === undefined ? {} : { description: truncate(choice.description, L.rowDescription) }),
  };
}

function truncate(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}
