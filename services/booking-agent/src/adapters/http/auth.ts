// Autenticação do painel: JWT do atendente emitido pelo OIDC (Keycloak). Assinatura, emissor, audiência
// e expiração são conferidos aqui mesmo que o api-gateway já tenha barrado antes (defesa em profundidade);
// o estúdio (role `tenant:<id>`) e o papel vêm só do token, nunca da URL nem de cabeçalho do cliente (ADR 0013).
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type Role = 'attendant' | 'manager';
const ROLES: readonly Role[] = ['attendant', 'manager'];
const TENANT_ROLE_PREFIX = 'tenant:';

export interface Principal {
  readonly subject: string;
  readonly tenantId: string;
  readonly roles: ReadonlySet<Role>;
}

export class Unauthenticated extends Error {
  constructor() {
    super('token ausente ou inválido');
    this.name = 'Unauthenticated';
  }
}

export interface TokenVerifier {
  verify(authorization: string | undefined): Promise<Principal>;
}

export interface JwtVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly keys: JWTVerifyGetKey;
}

export const remoteKeys = (jwksUrl: string): JWTVerifyGetKey => createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000 });

export function createJwtVerifier({ issuer, audience, keys }: JwtVerifierOptions): TokenVerifier {
  return {
    async verify(authorization) {
      const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
      if (!token) throw new Unauthenticated();
      try {
        const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], clockTolerance: 5, requiredClaims: ['exp', 'sub'] });
        // O estúdio do atendente é a role `tenant:<id>` do realm; exatamente uma, senão falha fechado.
        const realm = payload['realm_access'] as { roles?: unknown } | undefined;
        const granted = (Array.isArray(realm?.roles) ? realm.roles : []).filter((r): r is string => typeof r === 'string');
        const tenants = granted.filter((r) => r.startsWith(TENANT_ROLE_PREFIX)).map((r) => r.slice(TENANT_ROLE_PREFIX.length));
        const [tenantId] = tenants;
        if (tenants.length !== 1 || !tenantId) throw new Unauthenticated();
        const roles = new Set(ROLES.filter((role) => granted.includes(role)));
        return { subject: String(payload.sub), tenantId, roles };
      } catch (error) {
        throw error instanceof Unauthenticated ? error : new Unauthenticated();
      }
    },
  };
}

/** `manager` pode tudo que `attendant` pode. */
export function hasRole(principal: Principal, required: Role): boolean {
  return principal.roles.has(required) || principal.roles.has('manager');
}
