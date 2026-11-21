// Cliente LLM falso com respostas roteirizadas. Falha alto se o grafo chamar o modelo mais
// vezes do que o teste previu: chamada inesperada ao LLM também é bug.
import type { LlmClient, LlmMessage } from '../../src/agent/llm.js';

export class FakeLlmClient implements LlmClient {
  readonly calls: (readonly LlmMessage[])[] = [];
  private readonly script: string[];

  constructor(script: readonly (string | object)[] = []) {
    this.script = script.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    this.calls.push(messages);
    const next = this.script.shift();
    if (next === undefined) throw new Error(`FakeLlmClient: chamada ${String(this.calls.length)} não roteirizada.`);
    return next;
  }
}
