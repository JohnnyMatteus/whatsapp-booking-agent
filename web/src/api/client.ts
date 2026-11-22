// Cliente da API do painel. O proxy (Vite em dev, nginx em produção) injeta o token: o navegador não o vê.
import { ofetch, FetchError } from 'ofetch';
import type { z } from 'zod';
import { ConversationDetail, ConversationList, Metrics, Scope, SentMessage, type TimelineEntry } from './schemas';

export type StatusFilter = 'all' | 'handed_off' | 'bot_active';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`A API do painel respondeu ${String(status)}${code ? ` (${code})` : ''}.`);
    this.name = 'ApiError';
  }
}

export interface PanelApi {
  conversations(status?: StatusFilter): Promise<ConversationList>;
  conversation(conversationId: string): Promise<ConversationDetail>;
  send(conversationId: string, text: string): Promise<TimelineEntry>;
  resume(conversationId: string): Promise<void>;
  /** Miniatura da imagem de uma mensagem (o navegador não manda Authorization em <img>, então vem como blob). */
  thumbnail(messageId: string): Promise<Blob>;
  metrics(days: number): Promise<Metrics>;
  scope(): Promise<Scope>;
}

type Fetcher = typeof ofetch;

export function createPanelApi(tenantId: string, fetcher: Fetcher = ofetch): PanelApi {
  const base = `/api/tenants/${encodeURIComponent(tenantId)}`;
  const conversationUrl = (id: string) => `${base}/conversations/${encodeURIComponent(id)}`;

  async function call<S extends z.ZodType>(schema: S, url: string, options: Parameters<Fetcher>[1] = {}): Promise<z.infer<S>> {
    try {
      return schema.parse(await fetcher(url, options));
    } catch (error) {
      if (error instanceof FetchError) {
        const code = (error.data as { code?: unknown } | undefined)?.code;
        throw new ApiError(error.statusCode ?? 0, typeof code === 'string' ? code : null);
      }
      throw error;
    }
  }

  return {
    conversations: (status = 'all') => call(ConversationList, `${base}/conversations`, { query: { status } }),
    conversation: (id) => call(ConversationDetail, conversationUrl(id)),
    send: async (id, text) => (await call(SentMessage, `${conversationUrl(id)}/messages`, { method: 'POST', body: { text } })).entry,
    async resume(id) {
      try {
        await fetcher(`${conversationUrl(id)}/resume`, { method: 'POST' });
      } catch (error) {
        if (error instanceof FetchError) throw new ApiError(error.statusCode ?? 0, null);
        throw error;
      }
    },
    thumbnail: async (messageId) => {
      try {
        return await fetcher<Blob, 'blob'>(`${base}/media/${encodeURIComponent(messageId)}/thumbnail`, { responseType: 'blob' });
      } catch (error) {
        if (error instanceof FetchError) throw new ApiError(error.statusCode ?? 0, null);
        throw error;
      }
    },
    metrics: (days) => call(Metrics, `${base}/metrics`, { query: { days } }),
    scope: () => call(Scope, `${base}/scope`),
  };
}
