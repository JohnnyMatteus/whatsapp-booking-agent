// Protocolo próprio dentro dos ids de botões e linhas de lista. O sender codifica a ação
// e o alvo; a Meta devolve o id intacto quando o aluno toca, e o tradutor de entrada decodifica.
import type { ChoiceAction } from '@wba/contracts';

const PREFIX: Record<ChoiceAction, string> = { book: 'bk', waitlist: 'wl', cancel: 'cx' };
const ACTION_BY_PREFIX = new Map(Object.entries(PREFIX).map(([action, prefix]) => [prefix, action as ChoiceAction]));
const VERSION = 'v1';

export function encodeChoiceId(action: ChoiceAction, targetId: string): string {
  return `${VERSION}:${PREFIX[action]}:${targetId}`;
}

export function decodeChoiceId(id: string): { action: ChoiceAction; targetId: string } | null {
  const [version, prefix, ...rest] = id.split(':');
  const targetId = rest.join(':');
  const action = prefix === undefined ? undefined : ACTION_BY_PREFIX.get(prefix);
  if (version !== VERSION || action === undefined || targetId === '') return null;
  return { action, targetId };
}
