// Cliente HTTP da Cloud API (Graph API). A URL base é configurável: WireMock em desenvolvimento
// e no CI, graph.facebook.com em produção. Somente a API oficial (ADR 0003).
import { PermanentFailure } from '@wba/messaging';
import type { MetaOutboundMessage } from '../acl/cloud-api-types.js';
import type { CloudApiClient } from '../ports.js';

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
}
