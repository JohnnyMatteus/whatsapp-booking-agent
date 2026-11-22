// Schemas do Whatsmiau (webhook no formato Evolution API e corpos de envio). ÚNICO arquivo do
// repositório com tipos do Whatsmiau: o resto do sistema só vê a linguagem publicada. ADR 0002 e 0010.
//
// Fonte: repositório verbeux-ai/whatsmiau (dto de mensagens, modelos de webhook e swagger).
// Os schemas toleram campos novos e são estritos só no que o tradutor usa.
import { z } from 'zod';

export const WebhookEnvelope = z.object({
  event: z.string(),
  instance: z.string().min(1),
  data: z.unknown(),
  date_time: z.string().optional(),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

export const WookKey = z.object({
  remoteJid: z.string().min(1),
  remoteLid: z.string().optional(),
  fromMe: z.boolean().optional(),
  id: z.string().min(1),
  participant: z.string().optional(),
});

const MediaPart = z.object({ mimetype: z.string().optional(), ptt: z.boolean().optional() });

const WookMessageRaw = z.object({
  conversation: z.string().optional(),
  // ASSUNÇÃO: o texto longo ou com link pode chegar como extendedTextMessage (convenção Evolution).
  extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
  audioMessage: MediaPart.optional(),
  imageMessage: MediaPart.extend({ caption: z.string().optional() }).optional(),
  listResponseMessage: z
    .object({ title: z.string().optional(), singleSelectReply: z.object({ selectedRowId: z.string().optional() }).optional() })
    .optional(),
  buttonsResponseMessage: z.object({ selectedButtonId: z.string().optional(), selectedDisplayText: z.string().optional() }).optional(),
  reactionMessage: z.unknown().optional(),
  // Presentes quando o webhook está com base64 ligado ou o Whatsmiau tem armazenamento de mídia.
  base64: z.string().optional(),
  mediaUrl: z.string().optional(),
});

export const MessagesUpsertData = z.object({
  key: WookKey,
  pushName: z.string().optional(),
  message: WookMessageRaw.optional(),
  messageType: z.string(),
  messageTimestamp: z.number().int(),
});
export type MessagesUpsertData = z.infer<typeof MessagesUpsertData>;

export const MessagesUpdateData = z.object({
  keyId: z.string().optional(),
  messageId: z.string().optional(),
  remoteJid: z.string().min(1),
  status: z.string(),
});
export type MessagesUpdateData = z.infer<typeof MessagesUpdateData>;

/** Resposta dos endpoints de envio: só o id da mensagem interessa. */
export const SendResponse = z.object({ key: z.object({ id: z.string().min(1) }) });

/** Corpos de POST /v1/message/send{Text,Buttons,List}/{instance}. */
export type WhatsmiauOutbound =
  | { readonly path: 'sendText'; readonly body: { readonly number: string; readonly text: string } }
  | {
      readonly path: 'sendButtons';
      readonly body: {
        readonly number: string;
        readonly description: string;
        readonly buttons: readonly { readonly type: 'reply'; readonly displayText: string; readonly id: string }[];
      };
    }
  | {
      readonly path: 'sendList';
      readonly body: {
        readonly number: string;
        readonly description: string;
        readonly buttonText: string;
        readonly sections: readonly {
          readonly title: string;
          readonly rows: readonly { readonly title: string; readonly rowId: string; readonly description?: string }[];
        }[];
      };
    };

/** Limites do WhatsApp para mensagens interativas. ASSUNÇÃO: iguais aos da Cloud API (o Whatsmiau não os documenta). */
export const WHATSMIAU_LIMITS = {
  text: 4096,
  body: 1024,
  buttons: 3,
  buttonTitle: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
} as const;
