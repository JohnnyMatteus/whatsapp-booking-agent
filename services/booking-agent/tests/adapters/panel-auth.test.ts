// Autenticação e isolamento do painel, provados pelo ponto de entrada HTTP (ADR 0013):
// cada rota /api é chamada com token de outro estúdio, sem papel, expirado e forjado.
import { describe, expect, it } from 'vitest';
import { AUDIENCE, ephemeralPair, ISSUER } from '../support/tokens.js';
import { setup } from '../support/panel-harness.js';

const TENANT = 'estudio-lotus';
const CONVERSATION = encodeURIComponent(`${TENANT}:5511900000001`);

const ROUTES = [
  { name: 'lista de conversas', method: 'GET', url: `/api/tenants/${TENANT}/conversations`, role: 'attendant' },
  { name: 'detalhe da conversa', method: 'GET', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}`, role: 'attendant' },
  { name: 'resposta do atendente', method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/messages`, role: 'attendant', payload: { text: 'oi' } },
  { name: 'devolução ao bot', method: 'POST', url: `/api/tenants/${TENANT}/conversations/${CONVERSATION}/resume`, role: 'attendant' },
  { name: 'métricas', method: 'GET', url: `/api/tenants/${TENANT}/metrics?days=1`, role: 'manager' },
  { name: 'escopo', method: 'GET', url: `/api/tenants/${TENANT}/scope`, role: 'attendant' },
] as const;

describe.each(ROUTES)('$name', (route) => {
  const call = async (headers: Record<string, string>, ctx: Awaited<ReturnType<typeof setup>>) =>
    ctx.app.inject({ method: route.method, url: route.url, headers, ...('payload' in route ? { payload: route.payload } : {}) });

  it('não vaza entre estúdios: token de outro estúdio recebe 403 e nada é enviado nem alterado', async () => {
    const ctx = await setup({ handedOff: true });
    const before = ctx.published.length;

    const response = await call(await ctx.bearer({ tenant: 'estudio-sol', roles: ['manager'] }), ctx);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('5511900000001');
    expect(ctx.published).toHaveLength(before);
    expect((await ctx.conversations.load(TENANT, '5511900000001'))?.snapshot().status).toBe('handed_off');
  });

  it('recusa sem token, token expirado, forjado, de outra audiência e de outro emissor (401)', async () => {
    const ctx = await setup({ handedOff: true });
    const stranger = (await ephemeralPair()).sign;
    const attempts: Record<string, string>[] = [
      {},
      { authorization: 'Bearer lixo' },
      await ctx.bearer({ expiresIn: '-1m' }),
      await ctx.bearer({ signWith: stranger }),
      await ctx.bearer({ audience: 'outra-api' }),
      await ctx.bearer({ issuer: `${ISSUER}-falso` }),
      await ctx.bearer({ tenant: null }),
      { authorization: `Bearer ${await ctx.idp.token({ roles: ['attendant', 'tenant:estudio-sol'] })}` },
    ];

    for (const headers of attempts) expect((await call(headers, ctx)).statusCode).toBe(401);
    expect(ctx.published).toHaveLength(0);
  });

  it(route.role === 'manager' ? 'exige o papel manager (attendant recebe 403)' : 'aceita attendant e manager e recusa quem não tem papel (403)', async () => {
    const status = async (roles: string[]) => {
      const ctx = await setup({ handedOff: true });
      return (await call(await ctx.bearer({ roles }), ctx)).statusCode;
    };

    expect(await status([])).toBe(403);
    const asAttendant = await status(['attendant']);
    if (route.role === 'manager') expect(asAttendant).toBe(403);
    else expect(asAttendant).toBeLessThan(300);
    expect(await status(['manager'])).toBeLessThan(300);
  });
});

describe('rota interna', () => {
  it('não aceita JWT de atendente nem ausência de token (só o token de serviço)', async () => {
    const ctx = await setup();
    const url = `/internal/tenants/${TENANT}/notifications`;

    expect((await ctx.app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url, headers: await ctx.bearer({ roles: ['manager'] }), payload: {} })).statusCode).toBe(401);
  });
});

describe('o token é a única fonte de identidade', () => {
  it('ignora cabeçalhos de tenant ou papel enviados pelo cliente', async () => {
    const ctx = await setup({ handedOff: true });

    const response = await ctx.app.inject({ url: `/api/tenants/${TENANT}/conversations`, headers: { ...(await ctx.bearer({ tenant: 'estudio-sol' })), 'x-tenant-id': TENANT, 'x-roles': 'manager' } });

    expect(response.statusCode).toBe(403);
    expect(AUDIENCE).toBe('wba-api');
  });
});

// O roteador decodifica o caminho (`/%61pi` casa `/api`); a política não pode depender da string crua.
describe('caminhos codificados não contornam a autenticação', () => {
  const encodeSegment = (url: string, segment: string) => url.replace(`/${segment}`, `/%${segment.charCodeAt(0).toString(16)}${segment.slice(1)}`);
  const variants = (url: string): string[] => {
    const segments = url.split('?')[0]!.split('/').filter(Boolean).filter((s) => /^[a-z]/.test(s));
    return [url, ...segments.map((segment) => encodeSegment(url, segment)), segments.reduce((acc, segment) => encodeSegment(acc, segment), url)].filter((v, i, all) => all.indexOf(v) === i);
  };

  it.each(ROUTES)('$name: toda variante sem token é recusada e nada é executado', async (route) => {
    const ctx = await setup({ handedOff: true });

    for (const url of variants(route.url)) {
      const response = await ctx.app.inject({ method: route.method, url, ...('payload' in route ? { payload: route.payload } : {}) });
      expect([401, 404], `${route.method} ${url}`).toContain(response.statusCode);
      expect(response.body).not.toContain('5511900000001');
    }
    expect(ctx.published).toHaveLength(0);
  });

  it('a variante codificada chega à mesma rota quando há token (a recusa acima não é vácua)', async () => {
    const ctx = await setup({ handedOff: true });

    const url = `/%61pi/%74enants/${TENANT}/%73cope`;
    expect((await ctx.app.inject({ url })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url, headers: await ctx.bearer() })).statusCode).toBe(200);
  });

  it('a rota interna codificada continua exigindo o token de serviço e não executa o aviso', async () => {
    const ctx = await setup();
    const payload = { contactId: '5511900000001', kind: 'reminder', sessionId: 'ses-hatha-1', date: '2026-03-03' };

    for (const url of ['/%69nternal/tenants/' + TENANT + '/notifications', '/internal/%74enants/' + TENANT + '/%6eotifications', '/%69nternal/%74enants/' + TENANT + '/%6eotifications']) {
      const response = await ctx.app.inject({ method: 'POST', url, payload });
      expect([401, 404], url).toContain(response.statusCode);
    }
    expect(ctx.published).toHaveLength(0);
  });

  it('só /healthz e /metrics são públicos', async () => {
    const ctx = await setup();

    expect((await ctx.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/metrics' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/qualquer-coisa' })).statusCode).toBe(404);
  });
});
