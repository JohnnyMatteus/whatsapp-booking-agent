import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
  RABBITMQ_URL: 'amqp://x:y@rabbitmq:5672',
  REDIS_URL: 'redis://redis:6379',
  MEDIA_API_TOKEN: 'dev-only-internal-token',
  WHATSAPP_APP_SECRET: 'dev-only-change-me-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'dev-only-verify-token',
  WHATSAPP_ACCESS_TOKEN: 'dev-only-access-token',
};

describe('configuração por estúdio', () => {
  it('o padrão é a Cloud API: phoneNumberId sem provider vale cloud-api', () => {
    const config = loadConfig({ ...base, TENANT_CHANNELS: '{"estudio-lotus":{"phoneNumberId":"100000000000001"}}' });

    expect(config.tenants['estudio-lotus']).toEqual({ provider: 'cloud-api', phoneNumberId: '100000000000001' });
  });

  it('estúdio pode escolher o Whatsmiau, que então exige a sua configuração', () => {
    const tenants = '{"estudio-sol":{"provider":"whatsmiau","instance":"sol"}}';

    expect(() => loadConfig({ ...base, TENANT_CHANNELS: tenants })).toThrow(/WHATSMIAU_BASE_URL/);
    expect(
      loadConfig({
        ...base,
        TENANT_CHANNELS: tenants,
        WHATSMIAU_BASE_URL: 'http://miau:8081',
        WHATSMIAU_API_KEY: 'dev-only-apikey',
        WHATSMIAU_WEBHOOK_SECRET: 'dev-only-whatsmiau-webhook-secret',
      }).tenants['estudio-sol'],
    ).toEqual({ provider: 'whatsmiau', instance: 'sol' });
  });

  it('provedor inválido e JSON quebrado falham sem ecoar valores', () => {
    expect(() => loadConfig({ ...base, TENANT_CHANNELS: '{"a":{"provider":"x","phoneNumberId":"1"}}' })).toThrow('Configuração inválida: TENANT_CHANNELS');
    expect(() => loadConfig({ ...base, TENANT_CHANNELS: '{' })).toThrow('Configuração inválida: TENANT_CHANNELS');
  });
});
