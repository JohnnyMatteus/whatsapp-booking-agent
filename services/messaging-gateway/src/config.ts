// Configuração por variáveis de ambiente, validada na subida (falha cedo e explícita).
import { z } from 'zod';
import type { ProviderId } from './ports.js';

const TenantChannel = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('cloud-api'), phoneNumberId: z.string().min(1) }),
  z.object({ provider: z.literal('whatsmiau'), instance: z.string().min(1) }),
]);
export type TenantChannel = z.infer<typeof TenantChannel>;

// O provedor é por estúdio e o padrão é a Cloud API: `phoneNumberId` sozinho vale cloud-api.
const TenantChannels = z
  .record(
    z.string().min(1),
    z.preprocess((v) => (typeof v === 'object' && v !== null && !('provider' in v) ? { provider: 'cloud-api', ...v } : v), TenantChannel),
  )
  .refine((all) => Object.keys(all).length > 0, 'ao menos um estúdio');

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  RABBITMQ_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TENANT_CHANNELS: z.string().min(2),
  MEDIA_API_TOKEN: z.string().min(8),
  WHATSAPP_APP_SECRET: z.string().min(16),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_ACCESS_TOKEN: z.string().min(8),
  WHATSAPP_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSMIAU_BASE_URL: z.string().url().optional(),
  WHATSMIAU_API_KEY: z.string().min(8).optional(),
  WHATSMIAU_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Hosts de onde o gateway aceita baixar mídia (mediaUrl do webhook); padrão: o host do Whatsmiau.
  WHATSMIAU_MEDIA_HOSTS: z.string().optional(),
  SENDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  SENDER_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(5000),
  // Vazio = sem exportação: é o que o compose passa por padrão.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export interface GatewayConfig extends Omit<z.infer<typeof Env>, 'TENANT_CHANNELS'> {
  readonly tenants: Readonly<Record<string, TenantChannel>>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Só os nomes das variáveis: o valor pode ser segredo.
    throw new Error(`Configuração inválida: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const { TENANT_CHANNELS, ...rest } = parsed.data;
  let json: unknown;
  try {
    json = JSON.parse(TENANT_CHANNELS);
  } catch {
    throw new Error('Configuração inválida: TENANT_CHANNELS');
  }
  const tenants = TenantChannels.safeParse(json);
  if (!tenants.success) throw new Error('Configuração inválida: TENANT_CHANNELS');
  const providersUsed = new Set<ProviderId>(Object.values(tenants.data).map((t) => t.provider));
  if (providersUsed.has('whatsmiau') && (!rest.WHATSMIAU_BASE_URL || !rest.WHATSMIAU_API_KEY || !rest.WHATSMIAU_WEBHOOK_SECRET)) {
    throw new Error('Configuração inválida: WHATSMIAU_BASE_URL, WHATSMIAU_API_KEY, WHATSMIAU_WEBHOOK_SECRET');
  }
  return { ...rest, tenants: tenants.data };
}
