// Schemas da WhatsApp Cloud API (webhook e envio). ÚNICO arquivo do repositório com tipos
// da Meta: o resto do sistema só vê a linguagem publicada (@wba/contracts). ADR 0002.
//
// Os schemas são tolerantes a campos novos (a Meta acrescenta campos sem aviso) e estritos
// no que o tradutor usa.
import { z } from 'zod';

const MetaMessageBase = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().regex(/^\d+$/),
  context: z.object({ from: z.string().optional(), id: z.string() }).optional(),
});

const Interactive = z.discriminatedUnion('type', [
  z.object({ type: z.literal('button_reply'), button_reply: z.object({ id: z.string(), title: z.string() }) }),
  z.object({
    type: z.literal('list_reply'),
    list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }),
  }),
  z.object({
    type: z.literal('nfm_reply'),
    nfm_reply: z.object({ response_json: z.string(), body: z.string().optional(), name: z.string().optional() }),
  }),
]);

export const MetaMessage = z.discriminatedUnion('type', [
  MetaMessageBase.extend({ type: z.literal('text'), text: z.object({ body: z.string() }) }),
  MetaMessageBase.extend({
    type: z.literal('audio'),
    audio: z.object({ id: z.string(), mime_type: z.string(), voice: z.boolean().optional() }),
  }),
  MetaMessageBase.extend({ type: z.literal('interactive'), interactive: Interactive }),
  MetaMessageBase.extend({ type: z.literal('button'), button: z.object({ payload: z.string(), text: z.string() }) }),
  MetaMessageBase.extend({ type: z.literal('reaction'), reaction: z.object({ message_id: z.string(), emoji: z.string().optional() }) }),
  MetaMessageBase.extend({
    type: z.enum(['image', 'video', 'document', 'sticker', 'location', 'contacts', 'order', 'system', 'unsupported']),
  }),
]);
export type MetaMessage = z.infer<typeof MetaMessage>;

export const MetaStatus = z.object({
  id: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string().regex(/^\d+$/),
  recipient_id: z.string(),
  errors: z.array(z.object({ code: z.number().int(), title: z.string().optional() })).optional(),
});
export type MetaStatus = z.infer<typeof MetaStatus>;

const ChangeValue = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({ display_phone_number: z.string(), phone_number_id: z.string() }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
  // Item a item: um tipo desconhecido não derruba o lote inteiro.
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

export const WebhookPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;
export const MessagesChangeValue = ChangeValue;

/** Corpo do POST /{phone-number-id}/messages, só com os formatos que o sender usa. */
export type MetaOutboundMessage = {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
} & (
  | { readonly type: 'text'; readonly text: { readonly body: string; readonly preview_url: false } }
  | {
      readonly type: 'interactive';
      readonly interactive:
        | {
            readonly type: 'button';
            readonly body: { readonly text: string };
            readonly action: { readonly buttons: readonly { readonly type: 'reply'; readonly reply: { readonly id: string; readonly title: string } }[] };
          }
        | {
            readonly type: 'list';
            readonly body: { readonly text: string };
            readonly action: {
              readonly button: string;
              readonly sections: readonly {
                readonly title: string;
                readonly rows: readonly { readonly id: string; readonly title: string; readonly description?: string }[];
              }[];
            };
          };
    }
);

/** Limites documentados da Cloud API para mensagens interativas. */
export const CLOUD_API_LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  replyId: 256,
} as const;
