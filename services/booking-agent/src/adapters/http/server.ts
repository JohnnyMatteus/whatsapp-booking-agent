// API interna do painel do estúdio: fila de atendimento humano e devolução ao bot.
// Autenticação provisória por token (ADR 0004); a integração com o Keycloak do SaaS é
// próximo passo.
import type { Registry } from '@wba/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { HandoffQueue } from '../../application/ports.js';
import type { ResumeConversation } from '../../application/resume-conversation.js';
import { isDomainError } from '../../domain/errors.js';

export interface PanelApiDeps {
  readonly token: string;
  readonly handoffs: HandoffQueue;
  readonly resume: ResumeConversation;
  readonly registry: Registry;
}

/** O painel mostra o contato mascarado: o telefone completo não sai da API. */
export function maskContact(contactId: string): string {
  return contactId.length <= 4 ? '****' : `${'*'.repeat(contactId.length - 4)}${contactId.slice(-4)}`;
}

export function buildPanelApi(deps: PanelApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const expected = Buffer.from(`Bearer ${deps.token}`);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const received = Buffer.from(request.headers.authorization ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return reply.code(401).send({ error: 'não autorizado' });
    }
  });

  app.get<{ Params: { tenantId: string } }>('/api/tenants/:tenantId/handoffs', async (request) => {
    const tickets = await deps.handoffs.list(request.params.tenantId);
    return {
      data: tickets.map((t) => ({
        conversationId: t.conversationId,
        contact: maskContact(t.contactId),
        reason: t.reason,
        requestedAt: t.requestedAt,
      })),
    };
  });

  app.post<{ Params: { tenantId: string; conversationId: string } }>('/api/tenants/:tenantId/handoffs/:conversationId/resume', async (request, reply) => {
    const { tenantId, conversationId } = request.params;
    const ticket = (await deps.handoffs.list(tenantId)).find((t) => t.conversationId === conversationId);
    if (!ticket) return reply.code(404).send({ error: 'atendimento não encontrado' });
    try {
      await deps.resume.execute(tenantId, ticket.contactId);
    } catch (error) {
      if (isDomainError(error)) return reply.code(409).send({ error: error.message, code: error.code });
      throw error;
    }
    return reply.code(204).send();
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/metrics', async (_request, reply) => reply.type(deps.registry.contentType).send(await deps.registry.metrics()));
  return app;
}
