// Topologia do RabbitMQ (ADR 0006): um exchange topic, uma fila por consumidor, cada fila com
// sua fila de retry (TTL) e sua DLQ. Declarada por quem consome; publicar só exige o exchange.
import { MessageType } from './index.js';

export interface QueueSpec {
  readonly name: string;
  readonly bindings: readonly MessageType[];
}

export const Queues = {
  bookingAgent: {
    name: 'booking-agent.inbound',
    bindings: [
      MessageType.MessageReceived,
      MessageType.BookingRequested,
      MessageType.CancellationRequested,
      MessageType.WaitlistRequested,
      MessageType.DeliveryStatusChanged,
    ],
  },
  transcription: { name: 'transcription-worker.audio', bindings: [MessageType.AudioReceived] },
  sender: { name: 'whatsapp-sender.replies', bindings: [MessageType.ReplyRequested] },
  attendance: { name: 'attendance.handoffs', bindings: [MessageType.HandoffRequested] },
} as const satisfies Record<string, QueueSpec>;

export const retryQueueOf = (queue: string) => `${queue}.retry`;
export const deadLetterQueueOf = (queue: string) => `${queue}.dlq`;
