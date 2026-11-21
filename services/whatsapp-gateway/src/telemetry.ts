// Métricas do gateway (Prometheus). Nomes com o prefixo wba_ e rótulos de baixa cardinalidade.
import { Counter, Histogram, type Registry } from '@wba/observability';

export function createGatewayMetrics(registry: Registry) {
  return {
    webhookRequests: new Counter({
      name: 'wba_webhook_requests_total',
      help: 'Requisições ao webhook por resultado.',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    webhookItems: new Counter({
      name: 'wba_webhook_items_total',
      help: 'Itens do webhook (mensagens e status) por tipo de comando e destino.',
      labelNames: ['type', 'outcome'] as const,
      registers: [registry],
    }),
    outboundMessages: new Counter({
      name: 'wba_outbound_messages_total',
      help: 'Envios para a Cloud API por resultado.',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    cloudApiLatency: new Histogram({
      name: 'wba_cloud_api_request_seconds',
      help: 'Latência das chamadas de envio à Cloud API.',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    consumed: new Counter({
      name: 'wba_queue_messages_total',
      help: 'Mensagens consumidas por fila e destino (ack, retry, dead_letter).',
      labelNames: ['queue', 'result'] as const,
      registers: [registry],
    }),
  };
}

export type GatewayMetrics = ReturnType<typeof createGatewayMetrics>;
