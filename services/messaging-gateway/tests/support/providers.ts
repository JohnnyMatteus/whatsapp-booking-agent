// Composição de teste: Cloud API com cliente falso e o diretório de estúdios padrão.
import type { MetaOutboundMessage } from '../../src/providers/cloud-api/acl/cloud-api-types.js';
import type { CloudApiClient } from '../../src/providers/cloud-api/client.js';
import { CloudApiProvider } from '../../src/providers/cloud-api/provider.js';
import { ProviderRegistry } from '../../src/registry.js';
import { TenantChannels } from '../../src/tenants.js';
import type { MessagingProvider } from '../../src/ports.js';

export const APP_SECRET = 'dev-only-change-me-app-secret';
export const VERIFY_TOKEN = 'dev-only-verify-token';

export class FakeCloudApiClient implements CloudApiClient {
  sent: { phoneNumberId: string; message: MetaOutboundMessage }[] = [];
  async send(phoneNumberId: string, message: MetaOutboundMessage) {
    this.sent.push({ phoneNumberId, message });
    return { messageId: 'wamid.OUT' };
  }
  async fetchMedia() {
    return { data: Buffer.from('OggS-fake'), mimeType: 'audio/ogg' };
  }
}

export const channels = new TenantChannels({
  'estudio-lotus': { provider: 'cloud-api', phoneNumberId: '100000000000001' },
  'estudio-sol': { provider: 'whatsmiau', instance: 'sol' },
});

export function cloudApiRegistry(client: CloudApiClient = new FakeCloudApiClient(), extra: MessagingProvider[] = []) {
  const provider = new CloudApiProvider({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, client, directory: channels.forProvider('cloud-api') });
  return new ProviderRegistry([provider, ...extra], channels);
}
