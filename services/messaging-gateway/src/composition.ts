// Monta os provedores a partir da configuração. É o único lugar que conhece as classes concretas.
import { HttpCloudApiClient } from './providers/cloud-api/client.js';
import { CloudApiProvider } from './providers/cloud-api/provider.js';
import { HttpWhatsmiauClient } from './providers/whatsmiau/client.js';
import { WhatsmiauProvider } from './providers/whatsmiau/provider.js';
import type { GatewayConfig } from './config.js';
import type { InboundMediaCache, MessagingProvider } from './ports.js';
import { ProviderRegistry } from './registry.js';
import { TenantChannels } from './tenants.js';

export function buildProviders(config: GatewayConfig, mediaCache: InboundMediaCache): ProviderRegistry {
  const channels = new TenantChannels(config.tenants);
  const providers: MessagingProvider[] = [
    new CloudApiProvider({
      appSecret: config.WHATSAPP_APP_SECRET,
      verifyToken: config.WHATSAPP_VERIFY_TOKEN,
      directory: channels.forProvider('cloud-api'),
      client: new HttpCloudApiClient({
        baseUrl: config.WHATSAPP_API_BASE_URL,
        apiVersion: config.WHATSAPP_API_VERSION,
        accessToken: config.WHATSAPP_ACCESS_TOKEN,
        timeoutMs: 10_000,
      }),
    }),
  ];
  if (config.WHATSMIAU_BASE_URL && config.WHATSMIAU_API_KEY && config.WHATSMIAU_WEBHOOK_SECRET) {
    const mediaHosts = (config.WHATSMIAU_MEDIA_HOSTS ?? new URL(config.WHATSMIAU_BASE_URL).host).split(',').map((h) => h.trim());
    providers.push(
      new WhatsmiauProvider({
        webhookSecret: config.WHATSMIAU_WEBHOOK_SECRET,
        directory: channels.forProvider('whatsmiau'),
        client: new HttpWhatsmiauClient({ baseUrl: config.WHATSMIAU_BASE_URL, apiKey: config.WHATSMIAU_API_KEY, timeoutMs: 10_000 }),
        mediaCache,
        mediaHosts,
      }),
    );
  }
  return new ProviderRegistry(providers, channels);
}
