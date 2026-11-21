// Cliente LLM sobre a API compatível com OpenAI (/chat/completions). Em desenvolvimento aponta
// para um modelo local no Ollama; em produção, para qualquer provedor compatível.
import type { LlmClient, LlmMessage } from '../../agent/llm.js';

export class LlmTransportError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'LlmTransportError';
  }
}

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly options: { baseUrl: string; apiKey: string; model: string; timeoutMs: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.options.model, temperature: 0, response_format: { type: 'json_object' }, messages }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new LlmTransportError(`falha de rede no LLM: ${(error as Error).name}`, null);
    }
    // O corpo pode ecoar o prompt (dados do aluno): não entra na mensagem de erro.
    if (!response.ok) throw new LlmTransportError(`LLM respondeu ${String(response.status)}`, response.status);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new LlmTransportError('resposta do LLM sem conteúdo', response.status);
    return content;
  }
}
