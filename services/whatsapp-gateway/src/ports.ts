// Portas do gateway. Redis, RabbitMQ e a Cloud API ficam atrás delas.
import type { AnyEnvelope } from '@wba/contracts';
import type { MetaOutboundMessage } from './acl/cloud-api-types.js';

/** Idempotência pelo id da mensagem (ADR 0005). */
export interface IdempotencyStore {
  /** true se esta chamada reservou a chave; false se ela já tinha sido processada. */
  claim(key: string): Promise<boolean>;
  /** Desfaz a reserva quando a publicação falha, para a reentrega da Meta processar de novo. */
  release(key: string): Promise<void>;
}

export interface EnvelopePublisher {
  publish(envelope: AnyEnvelope): Promise<void>;
}

export interface CloudApiClient {
  send(phoneNumberId: string, message: MetaOutboundMessage): Promise<{ messageId: string }>;
}

export interface Clock {
  now(): Date;
}
