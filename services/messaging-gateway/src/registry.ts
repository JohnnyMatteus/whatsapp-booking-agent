// Resolve o provedor de cada estúdio. A escolha vem da configuração (TENANT_CHANNELS);
// quem chama só recebe a porta MessagingProvider e nunca sabe qual implementação é.
import type { MessagingProvider, ProviderId } from './ports.js';
import type { TenantChannels } from './tenants.js';

export class ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderId, MessagingProvider>;

  constructor(
    providers: readonly MessagingProvider[],
    private readonly channels: Pick<TenantChannels, 'providerOf'>,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  byId(id: string): MessagingProvider | null {
    return this.providers.get(id as ProviderId) ?? null;
  }

  forTenant(tenantId: string): MessagingProvider | null {
    const id = this.channels.providerOf(tenantId);
    return id === null ? null : (this.providers.get(id) ?? null);
  }
}
