// API interna do painel do estúdio: fila, conversa com contexto, resposta do atendente,
// devolução ao bot, métricas e política de escopo. Autenticação provisória por token
// injetado pelo proxy do painel (ADR 0004); a integração com o Keycloak do SaaS é próximo passo.
import type { Registry } from '@wba/observability';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { NotifyStudent } from '../../application/notify-student.js';
import type { PanelQueries, StatusFilter } from '../../application/panel-queries.js';
import type { ReplyAsAttendant } from '../../application/reply-as-attendant.js';
import type { ResumeConversation } from '../../application/resume-conversation.js';
import { scopeInfo } from '../../application/scope-info.js';
import { isDomainError, type DomainErrorCode } from '../../domain/errors.js';

export interface PanelApiDeps {
  readonly token: string;
  /** Token da rota interna de avisos, chamada pelo SaaS (sem passar pelo proxy do painel). */
  readonly internalToken: string;
  readonly queries: PanelQueries;
  readonly reply: ReplyAsAttendant;
  readonly resume: ResumeConversation;
  readonly notify: NotifyStudent;
  readonly registry: Registry;
}

/** O painel mostra o contato mascarado: o telefone completo não sai da API. */
export function maskContact(contactId: string): string {
  return contactId.length <= 4 ? '****' : `${'*'.repeat(contactId.length - 4)}${contactId.slice(-4)}`;
}

const STATUS_BY_CODE: Partial<Record<DomainErrorCode, number>> = {
  not_found: 404,
  conversation_with_bot: 409,
  customer_service_window_closed: 409,
  invalid_request: 409,
  class_session_started: 409,
};

const MessageBody = z.object({ text: z.string().trim().min(1).max(4096) });
const NoticeBody = z.object({
  contactId: z.string().min(1),
  kind: z.enum(['reminder', 'promotion']),
  sessionId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const StatusQuery = z.enum(['handed_off', 'bot_active', 'all']).default('all');
const DaysQuery = z.coerce.number().int().min(1).max(30).default(7);

const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/healthz', '/metrics']);

function equalToken(received: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(received ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildPanelApi(deps: PanelApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    // A rota casada, não request.url: o roteador decodifica o caminho (/%61pi/... cai em /api/...).
    const route = request.routeOptions.url;
    if (route === undefined || PUBLIC_ROUTES.has(route)) return;
    const token = route.startsWith('/internal/') ? deps.internalToken : deps.token;
    if (!equalToken(request.headers.authorization, token)) return reply.code(401).send({ error: 'não autorizado', code: 'unauthorized' });
  });

  const fail = (reply: FastifyReply, error: unknown) => {
    if (isDomainError(error)) return reply.code(STATUS_BY_CODE[error.code] ?? 422).send({ error: error.message, code: error.code });
    throw error;
  };
  const invalid = (reply: FastifyReply) => reply.code(400).send({ error: 'Requisição inválida.', code: 'invalid_request' });

  /** O id da conversa é `<estúdio>:<contato>`; o estúdio da rota precisa bater, senão é 404. */
  const contactOf = (tenantId: string, conversationId: string): string | null =>
    conversationId.startsWith(`${tenantId}:`) ? conversationId.slice(tenantId.length + 1) : null;

  const withMaskedContact = <T extends { contactId: string }>({ contactId, ...rest }: T) => ({ ...rest, contact: maskContact(contactId) });

  app.get<{ Params: { tenantId: string }; Querystring: { status?: string } }>('/api/tenants/:tenantId/conversations', async (request, reply) => {
    const status = StatusQuery.safeParse(request.query.status);
    if (!status.success) return invalid(reply);
    const { data, meta } = await deps.queries.listConversations(request.params.tenantId, status.data as StatusFilter);
    return { data: data.map(withMaskedContact), meta };
  });

  app.get<{ Params: { tenantId: string; conversationId: string } }>('/api/tenants/:tenantId/conversations/:conversationId', async (request, reply) => {
    const contact = contactOf(request.params.tenantId, request.params.conversationId);
    if (contact === null) return reply.code(404).send({ error: 'Conversa não encontrada.', code: 'not_found' });
    try {
      return withMaskedContact(await deps.queries.conversation(request.params.tenantId, contact));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { tenantId: string; conversationId: string } }>('/api/tenants/:tenantId/conversations/:conversationId/messages', async (request, reply) => {
    const body = MessageBody.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const contact = contactOf(request.params.tenantId, request.params.conversationId);
    if (contact === null) return reply.code(404).send({ error: 'Conversa não encontrada.', code: 'not_found' });
    try {
      const entry = await deps.reply.execute(request.params.tenantId, contact, body.data.text);
      return reply.code(202).send({ entry });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { tenantId: string; conversationId: string } }>('/api/tenants/:tenantId/conversations/:conversationId/resume', async (request, reply) => {
    const contact = contactOf(request.params.tenantId, request.params.conversationId);
    if (contact === null) return reply.code(404).send({ error: 'Conversa não encontrada.', code: 'not_found' });
    try {
      await deps.resume.execute(request.params.tenantId, contact);
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { tenantId: string }; Querystring: { days?: string } }>('/api/tenants/:tenantId/metrics', async (request, reply) => {
    const days = DaysQuery.safeParse(request.query.days);
    if (!days.success) return invalid(reply);
    return deps.queries.metrics(request.params.tenantId, days.data);
  });

  app.get('/api/tenants/:tenantId/scope', async () => scopeInfo());

  app.post<{ Params: { tenantId: string } }>('/internal/tenants/:tenantId/notifications', async (request, reply) => {
    const body = NoticeBody.safeParse(request.body);
    if (!body.success) return invalid(reply);
    try {
      const result = await deps.notify.execute({ tenantId: request.params.tenantId, ...body.data });
      return reply.code(result === 'sent' ? 202 : 200).send({ result });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/metrics', async (_request, reply) => reply.type(deps.registry.contentType).send(await deps.registry.metrics()));
  return app;
}
