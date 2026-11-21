// Tradutor de saída da ACL do WhatsApp: resposta neutra do domínio → corpo de envio da Cloud API.
// Decide o formato (texto, botões ou lista) e aplica os limites da Meta.
import type { Choice, ReplyRequested } from '@wba/contracts';
import { CLOUD_API_LIMITS as L, type MetaOutboundMessage } from '../cloud-api-types.js';
import { encodeChoiceId } from '../interactive-ids.js';

export const LIST_BUTTON_LABEL = 'Ver opções';
export const LIST_SECTION_TITLE = 'Aulas';

export function translateReply(reply: ReplyRequested): MetaOutboundMessage {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: reply.contactId } as const;
  const { content } = reply;

  if (content.kind === 'text') {
    return { ...base, type: 'text', text: { body: truncate(content.text, L.textBody), preview_url: false } };
  }

  const body = { text: truncate(content.body, L.interactiveBody) };
  // Botões não têm descrição: se alguma opção carrega horário na descrição, só a lista preserva.
  const fitsButtons =
    content.choices.length <= L.buttons && content.choices.every((c) => c.description === undefined && c.title.length <= L.buttonTitle);

  if (fitsButtons) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body,
        action: { buttons: content.choices.map((c) => ({ type: 'reply', reply: { id: choiceId(c), title: c.title } })) },
      },
    };
  }

  return {
    ...base,
    type: 'interactive',
    interactive: {
      type: 'list',
      body,
      action: {
        button: LIST_BUTTON_LABEL,
        sections: [
          {
            title: LIST_SECTION_TITLE,
            rows: content.choices.slice(0, L.listRows).map((c) => ({
              id: choiceId(c),
              title: truncate(c.title, L.rowTitle),
              ...(c.description === undefined ? {} : { description: truncate(c.description, L.rowDescription) }),
            })),
          },
        ],
      },
    },
  };
}

function choiceId(choice: Choice): string {
  const id = encodeChoiceId(choice.action, choice.targetId);
  if (id.length > L.replyId) throw new RangeError(`id de opção acima de ${String(L.replyId)} caracteres`);
  return id;
}

/** Corta em fronteira de caractere (não de byte) e marca o corte com reticências. */
export function truncate(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}
