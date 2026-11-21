// Eventos de domínio emitidos pela Conversa. A camada de aplicação os traduz para a linguagem
// publicada (contratos) depois de salvar o agregado.

export type HandoffReason = 'explicit_request' | 'repeated_failure' | 'sensitive_topic';

export type ConversationEvent =
  | { readonly type: 'handoff_requested'; readonly conversationId: string; readonly reason: HandoffReason; readonly at: Date }
  | { readonly type: 'bot_resumed'; readonly conversationId: string; readonly at: Date };
