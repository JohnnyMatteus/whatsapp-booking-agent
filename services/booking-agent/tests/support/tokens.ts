// Emissor de JWT de teste: par RS256 local no lugar do Keycloak.
import { generateKeyPair, SignJWT } from 'jose';
import type { webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;

export const ISSUER = 'http://idp.test/realms/wba';
export const AUDIENCE = 'wba-api';

export interface TestIdp {
  readonly keys: () => Promise<CryptoKey>;
  token(claims?: { tenant?: string | null; roles?: string[]; sub?: string; issuer?: string; audience?: string; expiresIn?: string; signWith?: CryptoKey }): Promise<string>;
}

/** Par RS256 efêmero, só na memória do teste: nada de chave em arquivo. */
export async function ephemeralPair(): Promise<{ verify: CryptoKey; sign: CryptoKey }> {
  const { publicKey: verify, ...rest } = await generateKeyPair('RS256');
  return { verify, sign: Object.values(rest)[0] as CryptoKey };
}

export async function createTestIdp(): Promise<TestIdp> {
  const { verify, sign } = await ephemeralPair();
  return {
    keys: async () => verify,
    async token({ tenant = 'estudio-lotus', roles = ['attendant'], sub = 'user-1', issuer = ISSUER, audience = AUDIENCE, expiresIn = '5m', signWith = sign } = {}) {
      const jwt = new SignJWT({ realm_access: { roles: tenant === null ? roles : [...roles, `tenant:${tenant}`] } })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(sub)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiresIn);
      return jwt.sign(signWith);
    },
  };
}
