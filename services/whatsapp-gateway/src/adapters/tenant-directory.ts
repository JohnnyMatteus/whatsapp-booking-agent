// Mapa número de WhatsApp Business (phone_number_id) ↔ estúdio, vindo da configuração.
import type { TenantDirectory } from '../acl/inbound/translate-webhook.js';

export class StaticTenantDirectory implements TenantDirectory {
  private readonly byTenant: Map<string, string>;

  constructor(private readonly byPhoneNumber: ReadonlyMap<string, string>) {
    this.byTenant = new Map([...byPhoneNumber].map(([phone, tenant]) => [tenant, phone]));
  }

  static fromJson(json: string): StaticTenantDirectory {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('TENANT_PHONE_NUMBERS deve ser um objeto JSON');
    return new StaticTenantDirectory(new Map(Object.entries(parsed).map(([k, v]) => [k, String(v)])));
  }

  tenantFor(phoneNumberId: string): string | null {
    return this.byPhoneNumber.get(phoneNumberId) ?? null;
  }

  phoneNumberFor(tenantId: string): string | null {
    return this.byTenant.get(tenantId) ?? null;
  }
}
