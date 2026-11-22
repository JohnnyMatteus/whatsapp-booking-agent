// Mapa estúdio ↔ canal (provedor e identificador de roteamento), vindo da configuração.
import type { TenantChannel } from './config.js';
import type { ProviderId } from './ports.js';

/** Visão de um provedor: resolve o id que ele usa (número, instância) ↔ estúdio. */
export interface ProviderDirectory {
  tenantFor(routingId: string): string | null;
  routingIdFor(tenantId: string): string | null;
}

const routingIdOf = (channel: TenantChannel): string => (channel.provider === 'cloud-api' ? channel.phoneNumberId : channel.instance);

export class TenantChannels {
  constructor(private readonly channels: Readonly<Record<string, TenantChannel>>) {}

  providerOf(tenantId: string): ProviderId | null {
    return this.channels[tenantId]?.provider ?? null;
  }

  forProvider(provider: ProviderId): ProviderDirectory {
    const entries = Object.entries(this.channels).filter(([, c]) => c.provider === provider);
    const byRouting = new Map(entries.map(([tenant, c]) => [routingIdOf(c), tenant]));
    const byTenant = new Map(entries.map(([tenant, c]) => [tenant, routingIdOf(c)]));
    return { tenantFor: (id) => byRouting.get(id) ?? null, routingIdFor: (tenant) => byTenant.get(tenant) ?? null };
  }
}
