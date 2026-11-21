// Porta do modelo de linguagem e geração estruturada: toda saída passa por um schema Zod,
// com exatamente um retry que mostra ao modelo o que estava errado.
import type { z } from 'zod';

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmClient {
  /** Devolve o texto bruto da resposta. Erro de transporte vira exceção do adaptador. */
  complete(messages: readonly LlmMessage[]): Promise<string>;
}

export class LlmOutputInvalid extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Saída do LLM inválida após o retry: ${issues.join('; ')}`);
    this.name = 'LlmOutputInvalid';
  }
}

export const STRUCTURED_ATTEMPTS = 2;

/**
 * `check` roda depois do schema para regras que dependem do contexto do turno
 * (ex.: o id citado precisa estar entre os que as ferramentas devolveram).
 */
export async function generateStructured<T>(
  llm: LlmClient,
  messages: readonly LlmMessage[],
  schema: z.ZodType<T>,
  check: (value: T) => readonly string[] = () => [],
): Promise<T> {
  const conversation: LlmMessage[] = [...messages];
  let issues: readonly string[] = [];

  for (let attempt = 1; attempt <= STRUCTURED_ATTEMPTS; attempt++) {
    const raw = await llm.complete(conversation);
    const parsed = parseJson(raw, schema);
    issues = parsed.ok ? check(parsed.value) : parsed.issues;
    if (parsed.ok && issues.length === 0) return parsed.value;
    conversation.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `Resposta rejeitada: ${issues.join('; ')}. Responda apenas com o JSON corrigido.` },
    );
  }
  throw new LlmOutputInvalid(issues);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function parseJson<T>(raw: string, schema: z.ZodType<T>): Parsed<T> {
  const unfenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(raw)?.[1] ?? raw;
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    return { ok: false, issues: ['não é JSON válido'] };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: result.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`) };
}
