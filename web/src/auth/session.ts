// Sessão do atendente: o estúdio e o papel vêm do access token emitido pelo Keycloak (ADR 0013).
// O navegador só decodifica o token para mostrar o estúdio e esconder o que o papel não alcança;
// quem decide o acesso é o api-gateway e o booking-agent, que validam a assinatura.
import { createFetch } from 'ofetch';

export type Role = 'attendant' | 'manager';

export interface Session {
  readonly name: string;
  readonly tenantId: string;
  readonly roles: readonly Role[];
}

export interface AuthUser {
  readonly accessToken: string;
  readonly name: string;
}

/** Porta do provedor de identidade (OIDC). A implementação real usa oidc-client-ts; os testes usam um falso. */
export interface AuthClient {
  user(): Promise<AuthUser | null>;
  /** Leva o navegador ao login; `returnTo` volta depois. */
  login(returnTo: string): Promise<void>;
  /** Conclui o retorno do login (código e PKCE) e devolve o caminho de origem. */
  completeLogin(): Promise<string>;
  logout(): Promise<void>;
}

export class MissingTenant extends Error {
  constructor() {
    super('O token não traz exatamente um estúdio.');
    this.name = 'MissingTenant';
  }
}

const TENANT_PREFIX = 'tenant:';

export function sessionFromUser({ accessToken, name }: AuthUser): Session {
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(accessToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as {
    realm_access?: { roles?: unknown };
  };
  const granted = (Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : []).filter((r): r is string => typeof r === 'string');
  const tenants = granted.filter((r) => r.startsWith(TENANT_PREFIX));
  const [tenant] = tenants;
  if (tenants.length !== 1 || !tenant) throw new MissingTenant();
  const roles = (['attendant', 'manager'] as const).filter((r) => granted.includes(r));
  return { name, tenantId: tenant.slice(TENANT_PREFIX.length), roles };
}

export const canAccess = (session: Session, required: Role): boolean => session.roles.includes(required) || session.roles.includes('manager');

export interface Navigator {
  readonly path: string;
  replace(path: string): void;
}

/** Resolve a sessão ao abrir o painel: conclui o retorno do login, reaproveita a sessão ou manda para o login. */
export async function establishSession(auth: AuthClient, where: Navigator): Promise<Session | null> {
  if (where.path.startsWith('/callback')) where.replace(await auth.completeLogin());
  const user = await auth.user();
  if (!user) {
    await auth.login(where.path.startsWith('/callback') ? '/' : where.path);
    return null;
  }
  return sessionFromUser(user);
}

/** fetch com o bearer do atendente; um 401 (token expirado ou revogado) leva de volta ao login. */
export function authenticatedFetcher(auth: AuthClient, currentPath: () => string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  return createFetch({ fetch: fetchImpl }).create({
    async onRequest({ options }) {
      const user = await auth.user();
      if (!user) {
        await auth.login(currentPath());
        throw new Error('sem sessão');
      }
      const headers = new Headers(options.headers);
      headers.set('authorization', `Bearer ${user.accessToken}`);
      options.headers = headers;
    },
    async onResponseError({ response }) {
      if (response.status === 401) await auth.login(currentPath());
    },
  });
}
