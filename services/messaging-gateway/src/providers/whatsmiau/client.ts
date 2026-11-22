// Cliente HTTP do Whatsmiau. Autenticação: cabeçalho `apikey` (variável API_KEY do servidor).
// Erros: só status entra na mensagem; o corpo pode ecoar o texto do aluno.
import { PermanentFailure } from '@wba/messaging';
import type { MediaContent } from '../../ports.js';
import { SendResponse, type WhatsmiauOutbound } from './acl/whatsmiau-types.js';

export class WhatsmiauTransientError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'WhatsmiauTransientError';
  }
}

/** 429 e 5xx melhoram esperando. 4xx (número inválido, instância desconectada, apikey) não. */
export function classifyWhatsmiauStatus(status: number): 'transient' | 'permanent' {
  return status === 429 || status >= 500 ? 'transient' : 'permanent';
}

export interface WhatsmiauClient {
  send(instance: string, message: WhatsmiauOutbound): Promise<{ messageId: string }>;
  download(url: string): Promise<MediaContent>;
}

export class HttpWhatsmiauClient implements WhatsmiauClient {
  constructor(
    private readonly options: { baseUrl: string; apiKey: string; timeoutMs: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(instance: string, message: WhatsmiauOutbound): Promise<{ messageId: string }> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/v1/message/${message.path}/${encodeURIComponent(instance)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { apikey: this.options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(message.body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new WhatsmiauTransientError(`falha de rede: ${(error as Error).name}`, null);
    }
    if (!response.ok) {
      const description = `Whatsmiau respondeu ${String(response.status)}`;
      if (classifyWhatsmiauStatus(response.status) === 'transient') throw new WhatsmiauTransientError(description, response.status);
      throw new PermanentFailure(description);
    }
    const parsed = SendResponse.safeParse(await response.json().catch(() => ({})));
    if (!parsed.success) throw new PermanentFailure('resposta do Whatsmiau sem id de mensagem');
    return { messageId: parsed.data.key.id };
  }

  async download(url: string): Promise<MediaContent> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.options.timeoutMs * 3) });
    } catch (error) {
      throw new WhatsmiauTransientError(`falha de rede: ${(error as Error).name}`, null);
    }
    if (!response.ok) {
      const description = `download de mídia respondeu ${String(response.status)}`;
      if (classifyWhatsmiauStatus(response.status) === 'transient') throw new WhatsmiauTransientError(description, response.status);
      throw new PermanentFailure(description);
    }
    return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? 'application/octet-stream' };
  }
}
