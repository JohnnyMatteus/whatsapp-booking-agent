// Observabilidade comum aos serviços Node (ver docs/design-doc.md, seção Observabilidade).
import { context, propagation, SpanStatusCode, trace, type Attributes, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { pino, type Logger } from 'pino';
import { collectDefaultMetrics, Registry } from 'prom-client';

/**
 * Campos com dado pessoal (telefone do aluno, texto da mensagem) nunca saem nos logs.
 * O id da mensagem do WhatsApp (correlationId) é o elo entre logs, traces e filas.
 */
const REDACT_PATHS = ['contactId', '*.contactId', 'text', '*.text', 'to', '*.to', 'body', '*.body', 'authorization', '*.authorization'];

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name: service,
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin: () => {
      const span = trace.getActiveSpan()?.spanContext();
      return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
    },
  });
}

export function createMetricsRegistry(service: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export interface Tracing {
  readonly tracer: Tracer;
  shutdown(): Promise<void>;
}

/** Sem endpoint OTLP os spans existem (correlação nos logs) mas não são exportados. */
export function setupTracing(service: string, version: string, otlpEndpoint?: string): Tracing {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: service, [ATTR_SERVICE_VERSION]: version }),
    spanProcessors: otlpEndpoint
      ? [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: `${otlpEndpoint.replace(/\/+$/, '')}/v1/traces` }) })]
      : [],
  });
  trace.setGlobalTracerProvider(provider);
  return { tracer: provider.getTracer(service, version), shutdown: () => provider.shutdown() };
}

/** Executa `fn` num span ativo; exceção marca o span com erro e é relançada. */
export function inSpan<T>(tracer: Tracer, name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export type { Logger } from 'pino';
export { Counter, Histogram, Gauge, type Registry } from 'prom-client';
