// Whatsmiau (não oficial, baseado em whatsmeow): adaptador da porta MessagingProvider.
// Alternativo à Cloud API, escolhido por estúdio. Riscos e quando usar: ADR 0010.
import type { ReplyRequested } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import { timingSafeEqual } from 'node:crypto';
import type { InboundMediaCache, MediaContent, MessagingProvider, WebhookRequest } from '../../ports.js';
import type { ProviderDirectory } from '../../tenants.js';
import { translateWhatsmiauWebhook } from './acl/inbound/translate-webhook.js';
import { translateReply } from './acl/outbound/translate-reply.js';
import type { WhatsmiauClient } from './client.js';

/** Cabeçalho que configuramos no webhook da instância (campo `headers`): o Whatsmiau não assina o corpo. */
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';
const MEDIA_TTL_SECONDS = 60 * 60;
const MAX_INLINE_BASE64 = 28 * 1024 * 1024;

export class WhatsmiauProvider implements MessagingProvider {
  readonly id = 'whatsmiau' as const;

  constructor(
    private readonly deps: {
      webhookSecret: string;
      client: WhatsmiauClient;
      directory: ProviderDirectory;
      mediaCache: InboundMediaCache;
      mediaHosts: readonly string[];
    },
  ) {}

  verifyWebhook(request: WebhookRequest): boolean {
    const received = Buffer.from(request.headers[WEBHOOK_SECRET_HEADER] ?? '');
    const expected = Buffer.from(this.deps.webhookSecret);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  async parseWebhook(body: unknown) {
    const { inlineMedia, ...result } = translateWhatsmiauWebhook(body, { tenantFor: (instance) => this.deps.directory.tenantFor(instance) });
    for (const media of inlineMedia) {
      if ((media.base64?.length ?? 0) > MAX_INLINE_BASE64) continue;
      await this.deps.mediaCache.put(`${media.tenantId}:${media.mediaId}`, { mimeType: media.mimeType, ...(media.base64 ? { base64: media.base64 } : {}), ...(media.url ? { url: media.url } : {}) }, MEDIA_TTL_SECONDS);
    }
    return result;
  }

  async send(reply: ReplyRequested): Promise<{ messageId: string }> {
    const instance = this.deps.directory.routingIdFor(reply.tenantId);
    if (instance === null) throw new PermanentFailure(`estúdio sem instância configurada: ${reply.tenantId}`);
    return this.deps.client.send(instance, translateReply(reply));
  }

  async fetchMedia(tenantId: string, mediaId: string): Promise<MediaContent> {
    const cached = await this.deps.mediaCache.get(`${tenantId}:${mediaId}`);
    if (cached === null) throw new PermanentFailure('mídia expirada ou desconhecida');
    if (cached.base64) return { data: Buffer.from(cached.base64, 'base64'), mimeType: cached.mimeType };
    if (cached.url) {
      const url = new URL(cached.url);
      // A URL vem do webhook (autenticado por segredo, mas de fora): só hosts da lista, evitando SSRF.
      if (!['http:', 'https:'].includes(url.protocol) || !this.deps.mediaHosts.includes(url.host)) throw new PermanentFailure('host de mídia não permitido');
      const media = await this.deps.client.download(cached.url);
      return { data: media.data, mimeType: cached.mimeType };
    }
    throw new PermanentFailure('webhook sem mídia embutida nem URL (ative base64 ou armazenamento no Whatsmiau)');
  }
}
