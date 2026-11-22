// Cliente HTTP da Cloud API (Graph API). A URL base é configurável: WireMock em desenvolvimento
// e no CI, graph.facebook.com em produção. Somente a API oficial (ADR 0003).
import { PermanentFailure } from '@wba/messaging';
import type { MediaContent } from '../../ports.js';
import type { MetaOutboundMessage } from './acl/cloud-api-types.js';

export class CloudApiTransientError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: number | null) {
    super(message);
    this.name = 'CloudApiTransientError';
  }
}

/** Códigos da Meta que melhoram esperando: limite de taxa e indisponibilidade. */
const TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056]);

/** Decide se um erro da Cloud API vale retry. Erro de parâmetro, janela de 24h ou token não valem. */
export function classifyCloudApiError(status: number, code: number | null): 'transient' | 'permanent' {
  if (status === 429 || status >= 500) return 'transient';
  if (code !== null && TRANSIENT_CODES.has(code)) return 'transient';
  return 'permanent';
}

export interface CloudApiClient {
  send(phoneNumberId: string, message: MetaOutboundMessage): Promise<{ messageId: string }>;
  fetchMedia(mediaId: string): Promise<MediaContent>;
}

export class HttpCloudApiClient implements CloudApiClient {
  constructor(
    private readonly options: { baseUrl: string; apiVersion: string; accessToken: string; timeoutMs: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phoneNumberId: string, message: MetaOutboundMessage): Promise<{ messageId: string }> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/${this.options.apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new CloudApiTransientError(`falha de rede: ${(error as Error).name}`, null, null);
    }

    const body = (await response.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number; type?: string } };
    if (response.ok) {
      const messageId = body.messages?.[0]?.id;
      if (!messageId) throw new PermanentFailure('resposta da Cloud API sem id de mensagem');
      return { messageId };
    }
    const code = typeof body.error?.code === 'number' ? body.error.code : null;
    // O corpo de erro pode ecoar o conteúdo enviado: só status e código entram na mensagem.
    const description = `Cloud API respondeu ${String(response.status)} (código ${String(code)})`;
    if (classifyCloudApiError(response.status, code) === 'transient') throw new CloudApiTransientError(description, response.status, code);
    throw new PermanentFailure(description);
  }

  /** GET /{media-id} devolve uma URL temporária que também exige o token. */
  async fetchMedia(mediaId: string): Promise<MediaContent> {
    const base = `${this.options.baseUrl.replace(/\/+$/, '')}/${this.options.apiVersion}`;
    const headers = { authorization: `Bearer ${this.options.accessToken}` };
    const signal = () => AbortSignal.timeout(this.options.timeoutMs * 3);
    try {
      const meta = await this.fetchImpl(`${base}/${encodeURIComponent(mediaId)}`, { headers, signal: signal() });
      if (!meta.ok) throw this.failure(meta.status, null);
      const { url, mime_type: mimeType } = (await meta.json()) as { url?: string; mime_type?: string };
      if (!url) throw new PermanentFailure('resposta de mídia da Cloud API sem url');
      const download = await this.fetchImpl(url, { headers, signal: signal() });
      if (!download.ok) throw this.failure(download.status, null);
      return { data: Buffer.from(await download.arrayBuffer()), mimeType: mimeType ?? download.headers.get('content-type') ?? 'application/octet-stream' };
    } catch (error) {
      if (error instanceof PermanentFailure || error instanceof CloudApiTransientError) throw error;
      throw new CloudApiTransientError(`falha de rede: ${(error as Error).name}`, null, null);
    }
  }

  private failure(status: number, code: number | null): Error {
    const description = `Cloud API respondeu ${String(status)} (código ${String(code)})`;
    return classifyCloudApiError(status, code) === 'transient' ? new CloudApiTransientError(description, status, code) : new PermanentFailure(description);
  }
}
