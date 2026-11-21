// Política de escopo determinística (ADR 0003). Roda antes de qualquer LLM e decide sozinha
// os casos claros: pedido de humano, tema sensível, fora do escopo e intenção explícita.
// O LLM só é consultado quando o veredito é `undecided`, e não pode reverter este.

export type Intent = 'list_slots' | 'book' | 'cancel' | 'join_waitlist' | 'greeting';

export type ScopeVerdict =
  | { readonly kind: 'handoff'; readonly reason: 'explicit_request' | 'sensitive_topic' }
  | { readonly kind: 'out_of_scope' }
  | { readonly kind: 'in_scope'; readonly intent: Intent }
  | { readonly kind: 'undecided' };

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

// A ordem importa: humano > sensível > fora do escopo > intenção.
const HUMAN_REQUEST: readonly Rule[] = [
  { name: 'atendente', pattern: /\b(atendente|recepcao|recepcionista|secretaria)\b/ },
  { name: 'humano', pattern: /\b(humano|pessoa de verdade|pessoa real|alguem da equipe|falar com (alguem|uma pessoa|o estudio|a professora|o professor))\b/ },
];

const SENSITIVE: readonly Rule[] = [
  { name: 'saude', pattern: /\b(dor|dores|lesao|lesionad\w*|machu[cq]\w*|hernia|fratura|cirurgia|operad[oa]|gravid\w*|gestante|pressao alta|tontura|remedio|medic[oa]|fisioterap\w*)\b/ },
  { name: 'saude_mental', pattern: /\b(ansiedade|depressao|crise|panico|suicid\w*)\b/ },
  { name: 'financeiro', pattern: /\b(reembolso|estorno|cobranca|cobrad[oa]|pagamento|boleto|fatura|mensalidade|cartao)\b/ },
  { name: 'conflito', pattern: /\b(reclama\w*|procon|processo|advogad\w*|assedio|denuncia\w*|desrespeit\w*)\b/ },
];

const OUT_OF_SCOPE: readonly Rule[] = [
  { name: 'conteudo_geral', pattern: /\b(receita|piada|poema|poesia|historia|redacao|traduz\w*|resum\w* (de|do|da)|dever de casa)\b/ },
  { name: 'tecnologia', pattern: /\b(codigo|programa\w*|python|javascript|planilha|chatgpt)\b/ },
  { name: 'atualidades', pattern: /\b(politica|eleicao|futebol|noticia\w*|previsao do tempo|bolsa de valores|investiment\w*|cripto\w*)\b/ },
];

const INTENTS: readonly { readonly intent: Intent; readonly pattern: RegExp }[] = [
  { intent: 'join_waitlist', pattern: /\b(lista de espera|fila de espera|entrar na fila|me avisa se abrir vaga)\b/ },
  { intent: 'cancel', pattern: /\b(cancel\w*|desmarc\w*|nao vou poder ir)\b/ },
  { intent: 'book', pattern: /\b(reserv\w*|agend\w*|marcar|quero fazer a aula|me inscrever)\b/ },
  { intent: 'list_slots', pattern: /\b(horarios?|grade|agenda|aulas?|vagas?|tem aula)\b/ },
  { intent: 'greeting', pattern: /^(oi+|ola|bom dia|boa tarde|boa noite|e ai|menu|ajuda)\W*$/ },
];

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyScope(text: string): ScopeVerdict {
  const normalized = normalize(text);
  if (normalized === '') return { kind: 'undecided' };
  if (matches(HUMAN_REQUEST, normalized)) return { kind: 'handoff', reason: 'explicit_request' };
  if (matches(SENSITIVE, normalized)) return { kind: 'handoff', reason: 'sensitive_topic' };
  if (matches(OUT_OF_SCOPE, normalized)) return { kind: 'out_of_scope' };
  const intent = INTENTS.find((rule) => rule.pattern.test(normalized));
  return intent ? { kind: 'in_scope', intent: intent.intent } : { kind: 'undecided' };
}

function matches(rules: readonly Rule[], text: string): boolean {
  return rules.some((rule) => rule.pattern.test(text));
}
