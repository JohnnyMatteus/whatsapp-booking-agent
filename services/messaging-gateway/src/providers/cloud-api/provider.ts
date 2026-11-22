// Meta WhatsApp Cloud API (oficial): adaptador da porta MessagingProvider.
import type { ReplyRequested } from '@wba/contracts';
import { PermanentFailure } from '@wba/messaging';
import type { MediaContent, MessagingProvider, WebhookRequest } from '../../ports.js';
import type { ProviderDirectory } from '../../tenants.js';
import { translateReply } from './acl/outbound/translate-reply.js';
import { translateWebhook } from './acl/inbound/translate-webhook.js';
import type { CloudApiClient } from './client.js';
import { isValidSignature, isValidVerifyToken } from './signature.js';

export class CloudApiProvider implements MessagingProvider {
  readonly id = 'cloud-api' as const;

  constructor(
    private readonly deps: { appSecret: string; verifyToken: string; client: CloudApiClient; directory: ProviderDirectory },
  ) {}

  verifyWebhook(request: WebhookRequest): boolean {
    return isValidSignature(request.rawBody, request.headers['x-hub-signature-256'], this.deps.appSecret);
  }

  verifySubscription(query: Readonly<Record<string, string | undefined>>): string | null {
    return query['hub.mode'] === 'subscribe' && isValidVerifyToken(query['hub.verify_token'], this.deps.verifyToken) ? (query['hub.challenge'] ?? '') : null;
  }

  async parseWebhook(body: unknown) {
    return translateWebhook(body, { tenantFor: (id) => this.deps.directory.tenantFor(id) });
  }

  async send(reply: ReplyRequested): Promise<{ messageId: string }> {
    const phoneNumberId = this.deps.directory.routingIdFor(reply.tenantId);
    if (phoneNumberId === null) throw new PermanentFailure(`estúdio sem número configurado: ${reply.tenantId}`);
    return this.deps.client.send(phoneNumberId, translateReply(reply));
  }

  fetchMedia(_tenantId: string, mediaId: string): Promise<MediaContent> {
    return this.deps.client.fetchMedia(mediaId);
  }
}
