// Configuração por variáveis de ambiente, validada na subida (falha cedo e explícita).
import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  RABBITMQ_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WHATSAPP_APP_SECRET: z.string().min(16),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_ACCESS_TOKEN: z.string().min(8),
  WHATSAPP_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  TENANT_PHONE_NUMBERS: z.string().min(2),
  SENDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  SENDER_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(5000),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});
export type GatewayConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Só os nomes das variáveis: o valor pode ser segredo.
    throw new Error(`Configuração inválida: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
