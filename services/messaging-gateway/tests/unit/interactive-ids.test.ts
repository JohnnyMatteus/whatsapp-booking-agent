import { describe, expect, it } from 'vitest';
import { decodeChoiceId, encodeChoiceId } from '../../src/domain/interactive-ids.js';

describe('protocolo de ids interativos', () => {
  it('faz ida e volta preservando ":" no alvo', () => {
    expect(decodeChoiceId(encodeChoiceId('cancel', 'bk:123'))).toEqual({ action: 'cancel', targetId: 'bk:123' });
  });

  it.each(['', 'v1:bk:', 'v2:bk:ses-1', 'v1:zz:ses-1', 'Ver horários'])('rejeita id que não é nosso: "%s"', (id) => {
    expect(decodeChoiceId(id)).toBeNull();
  });
});
