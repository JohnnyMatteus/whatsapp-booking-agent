import type { HandoffReason } from '../api/schemas';

export const REASON_LABEL: Record<HandoffReason, string> = {
  explicit_request: 'pedido explícito',
  repeated_failure: '2 falhas seguidas',
  sensitive_topic: 'tema sensível',
};

export const ACTION_LABEL = { book: 'Reservar', waitlist: 'Entrar na fila', cancel: 'Cancelar reserva' } as const;
export const TEMPLATE_LABEL = { lembrete_aula: 'lembrete de aula', vaga_liberada: 'vaga liberada' } as const;

export const REJECTION_LABEL: Record<string, string> = {
  unsupported_type: 'formato não aceito',
  too_large: 'arquivo grande demais',
  type_mismatch: 'o conteúdo não é do tipo declarado',
  corrupt: 'arquivo corrompido',
  unavailable: 'mídia expirada no WhatsApp',
};

export const ERROR_MESSAGES: Record<string, string> = {
  conversation_with_bot: 'A conversa está com o bot. Só dá para responder depois da transferência.',
  customer_service_window_closed: 'Passaram 24 h da última mensagem do aluno: a Cloud API só aceita template agora.',
  not_found: 'Conversa não encontrada.',
};
