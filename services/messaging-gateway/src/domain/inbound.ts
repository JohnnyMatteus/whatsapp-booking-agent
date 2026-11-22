// Resultado neutro da tradução de um webhook. É o que qualquer provedor entrega ao gateway:
// só linguagem publicada (@wba/contracts), nenhum tipo de provedor.
import type { MessageType, PayloadOf } from '@wba/contracts';

type CommandOf<T extends MessageType> = { readonly type: T; readonly payload: PayloadOf<T> };
export type InboundCommand =
  | CommandOf<typeof MessageType.MessageReceived>
  | CommandOf<typeof MessageType.MediaReceived>
  | CommandOf<typeof MessageType.BookingRequested>
  | CommandOf<typeof MessageType.CancellationRequested>
  | CommandOf<typeof MessageType.WaitlistRequested>
  | CommandOf<typeof MessageType.DeliveryStatusChanged>;

export interface Translated {
  /** Chave de idempotência: o id da mensagem (ou id + status, para status de entrega). */
  readonly dedupKey: string;
  readonly correlationId: string;
  readonly command: InboundCommand;
}

export interface Ignored {
  readonly reason:
    | 'unknown_tenant'
    | 'unsupported_field'
    | 'reaction'
    | 'system_message'
    | 'malformed_item'
    | 'own_message'
    | 'group_chat'
    | 'unsupported_address'
    | 'unsupported_event';
  readonly detail: string;
}

export interface TranslationResult {
  readonly translated: readonly Translated[];
  readonly ignored: readonly Ignored[];
}

export class MalformedWebhook extends Error {
  constructor(provider: string, detail: string) {
    super(`Webhook fora do formato de ${provider}: ${detail}`);
    this.name = 'MalformedWebhook';
  }
}
