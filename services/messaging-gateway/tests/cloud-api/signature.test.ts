import { describe, expect, it } from 'vitest';
import { isValidSignature, isValidVerifyToken, signBody } from '../../src/providers/cloud-api/signature.js';

const SECRET = 'dev-only-change-me-app-secret';
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

describe('X-Hub-Signature-256', () => {
  it('aceita a assinatura do corpo exato', () => {
    expect(isValidSignature(body, signBody(body, SECRET), SECRET)).toBe(true);
  });

  it.each([
    ['ausente', undefined],
    ['sem prefixo', signBody(body, SECRET).slice('sha256='.length)],
    ['outro segredo', signBody(body, 'outro-segredo-qualquer')],
    ['truncada', signBody(body, SECRET).slice(0, 20)],
    ['hex inválido', 'sha256=zzzz'],
  ])('rejeita assinatura %s', (_name, header) => {
    expect(isValidSignature(body, header, SECRET)).toBe(false);
  });

  it('rejeita o mesmo JSON re-serializado com outros bytes', () => {
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));

    expect(isValidSignature(reformatted, signBody(body, SECRET), SECRET)).toBe(false);
  });

  it('compara o token de verificação com tamanhos diferentes sem lançar', () => {
    expect(isValidVerifyToken('curto', 'token-de-verificacao')).toBe(false);
    expect(isValidVerifyToken(undefined, 'token-de-verificacao')).toBe(false);
    expect(isValidVerifyToken('token-de-verificacao', 'token-de-verificacao')).toBe(true);
  });
});
