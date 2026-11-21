// Cliente da API do painel (booking-agent). Mesmo domínio: o proxy cuida do token.

export type HandoffReason = 'explicit_request' | 'repeated_failure' | 'sensitive_topic';

export interface HandoffTicket {
  readonly conversationId: string;
  readonly contact: string;
  readonly reason: HandoffReason;
  readonly requestedAt: string;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`A API do painel respondeu ${String(status)}.`);
    this.name = 'ApiError';
  }
}

export interface HandoffApi {
  list(tenantId: string): Promise<HandoffTicket[]>;
  resume(tenantId: string, conversationId: string): Promise<void>;
}

export function createHandoffApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): HandoffApi {
  const base = (tenantId: string) => `/api/tenants/${encodeURIComponent(tenantId)}/handoffs`;
  return {
    async list(tenantId) {
      const response = await fetchImpl(base(tenantId), { headers: { accept: 'application/json' } });
      if (!response.ok) throw new ApiError(response.status);
      const body = (await response.json()) as { data: HandoffTicket[] };
      return body.data;
    },
    async resume(tenantId, conversationId) {
      const response = await fetchImpl(`${base(tenantId)}/${encodeURIComponent(conversationId)}/resume`, { method: 'POST' });
      if (!response.ok) throw new ApiError(response.status);
    },
  };
}

export const REASON_LABELS: Record<HandoffReason, string> = {
  explicit_request: 'Pediu atendimento',
  repeated_failure: 'Bot não conseguiu resolver',
  sensitive_topic: 'Tema sensível',
};

/** "há 5 min", "há 2 h": quanto tempo o aluno está esperando. */
export function waitingTime(requestedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(requestedAt)) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${String(minutes)} min`;
  return `há ${String(Math.floor(minutes / 60))} h`;
}
