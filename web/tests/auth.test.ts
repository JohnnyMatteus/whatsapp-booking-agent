import { describe, expect, it, vi } from 'vitest';
import { authenticatedFetcher, canAccess, establishSession, MissingTenant, sessionFromUser, type AuthClient, type AuthUser } from '../src/auth/session';
import { createAppRouter } from '../src/router';
import { createMemoryHistory } from 'vue-router';

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenWith = (roles: string[]) => `${b64({ alg: 'RS256' })}.${b64({ realm_access: { roles } })}.assinatura`;
const user = (roles: string[]): AuthUser => ({ accessToken: tokenWith(roles), name: 'Ana Dev' });

function fakeAuth(current: AuthUser | null): AuthClient & { login: ReturnType<typeof vi.fn> } {
  return {
    user: vi.fn().mockResolvedValue(current),
    login: vi.fn().mockResolvedValue(undefined),
    completeLogin: vi.fn().mockResolvedValue('/metricas'),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

describe('sessão do atendente', () => {
  it('lê estúdio e papéis do token', () => {
    expect(sessionFromUser(user(['attendant', 'tenant:estudio-lotus', 'offline_access']))).toEqual({ name: 'Ana Dev', tenantId: 'estudio-lotus', roles: ['attendant'] });
  });

  it('falha fechado sem estúdio ou com mais de um', () => {
    expect(() => sessionFromUser(user(['attendant']))).toThrow(MissingTenant);
    expect(() => sessionFromUser(user(['attendant', 'tenant:a', 'tenant:b']))).toThrow(MissingTenant);
  });

  it('manager alcança o que attendant alcança, e não o contrário', () => {
    expect(canAccess({ name: 'x', tenantId: 't', roles: ['manager'] }, 'attendant')).toBe(true);
    expect(canAccess({ name: 'x', tenantId: 't', roles: ['attendant'] }, 'manager')).toBe(false);
  });
});

describe('abertura do painel', () => {
  it('sem sessão vai ao login guardando o caminho e não monta nada', async () => {
    const auth = fakeAuth(null);

    const session = await establishSession(auth, { path: '/conversas/abc', replace: vi.fn() });

    expect(session).toBeNull();
    expect(auth.login).toHaveBeenCalledWith('/conversas/abc');
  });

  it('com sessão devolve o estúdio do token', async () => {
    const session = await establishSession(fakeAuth(user(['attendant', 'tenant:estudio-sol'])), { path: '/', replace: vi.fn() });

    expect(session?.tenantId).toBe('estudio-sol');
  });

  it('no retorno do login conclui o fluxo e volta ao caminho de origem', async () => {
    const auth = fakeAuth(user(['manager', 'tenant:estudio-lotus']));
    const replace = vi.fn();

    await establishSession(auth, { path: '/callback?code=1&state=2', replace });

    expect(auth.completeLogin).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/metricas');
  });
});

describe('chamadas à API', () => {
  const okFetch = (status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status, headers: { 'content-type': 'application/json' } }));

  it('envia o bearer do atendente', async () => {
    const fetchImpl = okFetch();
    const fetcher = authenticatedFetcher(fakeAuth(user(['attendant', 'tenant:estudio-lotus'])), () => '/', fetchImpl);

    await fetcher('/api/tenants/estudio-lotus/scope');

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${tokenWith(['attendant', 'tenant:estudio-lotus'])}`);
  });

  it('um 401 leva de volta ao login', async () => {
    const auth = fakeAuth(user(['attendant', 'tenant:estudio-lotus']));
    const fetcher = authenticatedFetcher(auth, () => '/conversas', okFetch(401));

    await expect(fetcher('/api/tenants/estudio-lotus/scope')).rejects.toThrow();

    expect(auth.login).toHaveBeenCalledWith('/conversas');
  });

  it('sem sessão não chama a API', async () => {
    const fetchImpl = okFetch();
    const auth = fakeAuth(null);

    await expect(authenticatedFetcher(auth, () => '/', fetchImpl)('/api/x')).rejects.toThrow();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(auth.login).toHaveBeenCalled();
  });
});

describe('rotas por papel', () => {
  it('attendant que abre as métricas volta para as conversas', async () => {
    const router = createAppRouter(createMemoryHistory(), { name: 'Ana', tenantId: 'estudio-lotus', roles: ['attendant'] });

    await router.push('/metricas');

    expect(router.currentRoute.value.name).toBe('inbox');
  });
});
