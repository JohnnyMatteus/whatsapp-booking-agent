// Adaptador do oidc-client-ts: authorization code com PKCE (S256), sem segredo no navegador.
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { z } from 'zod';
import type { AuthClient } from './session';

export const OidcConfig = z.object({ issuer: z.url(), clientId: z.string().min(1) });
export type OidcConfig = z.infer<typeof OidcConfig>;

export async function loadOidcConfig(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<OidcConfig> {
  const response = await fetchImpl('/config.json');
  if (!response.ok) throw new Error('Configuração de login indisponível.');
  return OidcConfig.parse(await response.json());
}

export function createOidcClient(config: OidcConfig, origin: string): AuthClient {
  const manager = new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${origin}/callback`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: 'openid profile',
    // Sessão da aba: fechar o navegador encerra o login.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: true,
  });
  return {
    async user() {
      const user = await manager.getUser();
      return user && !user.expired ? { accessToken: user.access_token, name: String(user.profile.name ?? user.profile.preferred_username ?? 'atendente') } : null;
    },
    login: (returnTo) => manager.signinRedirect({ state: returnTo }),
    async completeLogin() {
      const user = await manager.signinRedirectCallback();
      return typeof user.state === 'string' && user.state.startsWith('/') ? user.state : '/';
    },
    logout: () => manager.signoutRedirect(),
  };
}
