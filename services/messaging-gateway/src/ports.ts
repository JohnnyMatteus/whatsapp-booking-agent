// Portas do messaging-gateway. Provedores de WhatsApp, Redis e RabbitMQ ficam atrás delas;
// o domínio e o booking-agent só conhecem a linguagem publicada (@wba/contracts).
import type { AnyEnvelope, ReplyRequested } from '@wba/contracts';
import type { TranslationResult } from './domain/inbound.js';

export type ProviderId = 'cloud-api' | 'whatsmiau';

/** Pedido HTTP de webhook como chegou: o corpo é o buffer exato, necessário para assinaturas. */
export interface WebhookRequest {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface MediaContent {
  readonly data: Buffer;
  readonly mimeType: string;
}

/**
 * Porta única dos provedores de WhatsApp: envio (texto, botões, listas e templates),
 * recebimento de webhook, status de entrega e mídia. Cada provedor traduz de e para a
 * linguagem publicada na sua própria ACL.
 */
export interface MessagingProvider {
  readonly id: ProviderId;
  /** Autenticidade do webhook (assinatura HMAC ou segredo compartilhado). */
  verifyWebhook(request: WebhookRequest): boolean;
  /** Handshake de inscrição, para provedores que o exigem (GET). null = recusar. */
  verifySubscription?(query: Readonly<Record<string, string | undefined>>): string | null;
  /** Traduz o webhook (mensagens e status de entrega) para comandos neutros. */
  parseWebhook(body: unknown): Promise<TranslationResult>;
  /** Envia a resposta do estúdio ao aluno. Erros: PermanentFailure ou transitório (retry). */
  send(reply: ReplyRequested): Promise<{ messageId: string }>;
  /** Baixa a mídia recebida pelo id publicado em MediaReceived. */
  fetchMedia(tenantId: string, mediaId: string): Promise<MediaContent>;
}

/** Idempotência pelo id da mensagem (ADR 0005). */
export interface IdempotencyStore {
  /** true se esta chamada reservou a chave; false se ela já tinha sido processada. */
  claim(key: string): Promise<boolean>;
  /** Desfaz a reserva quando a publicação falha, para a reentrega do provedor processar de novo. */
  release(key: string): Promise<void>;
}

export interface EnvelopePublisher {
  publish(envelope: AnyEnvelope): Promise<void>;
}

/** Guarda curta de mídia que o provedor entrega dentro do webhook (Whatsmiau com base64). */
export interface InboundMediaCache {
  put(key: string, entry: CachedMedia, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<CachedMedia | null>;
}
export interface CachedMedia {
  readonly mimeType: string;
  readonly base64?: string;
  readonly url?: string;
}

export interface Clock {
  now(): Date;
}
