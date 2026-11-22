// Configuração por ambiente, validada na subida. Mensagens de erro citam só o nome da variável.
import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8081),
  RABBITMQ_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MCP_SERVER_URL: z.string().url(),
  MCP_AUTH_TOKEN: z.string().min(16),
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(20_000),
  STUDIO_TIMEZONE: z.string().default('America/Sao_Paulo'),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URL: z.string().url(),
  INTERNAL_API_TOKEN: z.string().min(16),
  MEDIA_PROCESSOR_URL: z.string().url(),
  MEDIA_API_TOKEN: z.string().min(16),
  REMINDER_TENANTS: z.string().default('estudio-lotus'),
  REMINDER_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
  CONTACT_LOCK_WAIT_MS: z.coerce.number().int().min(0).default(15_000),
  OUTBOX_SWEEP_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  CONSUMER_PREFETCH: z.coerce.number().int().min(1).default(5),
  CONSUMER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(4),
  CONSUMER_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(3000),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});
export type AgentConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`Configuração inválida: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return parsed.data;
}
