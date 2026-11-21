// Testes de contrato do tradutor de entrada: payloads reais da Cloud API (anonimizados)
// precisam virar exatamente estes comandos da linguagem publicada.
import { MessageType, parseEnvelope, createEnvelope } from '@wba/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MalformedWebhook, translateWebhook, type TenantDirectory } from '../../src/acl/inbound/translate-webhook.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/inbound/${name}.json`, import.meta.url), 'utf8'));
const tenants: TenantDirectory = { tenantFor: (id) => (id === '100000000000001' ? 'estudio-lotus' : null) };
const translate = (name: string) => translateWebhook(fixture(name), tenants);

describe('ACL WhatsApp: webhook → linguagem publicada', () => {
  it('texto vira MensagemRecebida com estúdio resolvido pelo número de destino', () => {
    const { translated, ignored } = translate('text-message');

    expect(ignored).toEqual([]);
    expect(translated).toEqual([
      {
        dedupKey: 'wamid.HBgNNTUxMTkwMDAwMDAwMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==',
        correlationId: 'wamid.HBgNNTUxMTkwMDAwMDAwMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==',
        command: {
          type: MessageType.MessageReceived,
          payload: {
            tenantId: 'estudio-lotus',
            contactId: '5511900000001',
            messageId: 'wamid.HBgNNTUxMTkwMDAwMDAwMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==',
            receivedAt: '2026-03-02T12:00:00.000Z',
            content: { kind: 'text', text: 'Quais horários tem amanhã?', transcribed: false },
          },
        },
      },
    ]);
  });

  it('áudio de voz vira AudioRecebido para o transcritor', () => {
    const [item] = translate('audio-voice').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.AudioReceived,
      payload: { mediaId: '900000000000001', mimeType: 'audio/ogg; codecs=opus', contactId: '5511900000002' },
    });
  });

  it('escolha numa lista vira PedidoDeReserva', () => {
    const [item] = translate('interactive-list-reply').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.BookingRequested,
      payload: { sessionId: '01JNX0000000000000000HATHA', source: 'list' },
    });
  });

  it('botão de cancelamento vira PedidoDeCancelamento', () => {
    const [item] = translate('interactive-button-cancel').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.CancellationRequested,
      payload: { bookingId: '01JNX00000000000000BOOKING1', source: 'button' },
    });
  });

  it('conclusão do Flow vira pedido de lista de espera', () => {
    const [item] = translate('flow-completion').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.WaitlistRequested,
      payload: { sessionId: '01JNX000000000000000PILATES', source: 'form' },
    });
  });

  it('resposta rápida de template sem id nosso vira texto digitado', () => {
    const [item] = translate('template-quick-reply').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.MessageReceived,
      payload: { content: { kind: 'text', text: 'Ver horários' } },
    });
  });

  it('status de entrega vira evento, com o código de erro da Meta quando falha', () => {
    const { translated } = translate('statuses');

    expect(translated.map((t) => t.dedupKey)).toEqual([
      'status:wamid.HBgNNTUxMTkwMDAwMDAwMRUCABEYEjAwMDAwMDAwMDAwMDAwMDAwNQA=:delivered',
      'status:wamid.HBgNNTUxMTkwMDAwMDAwMxUCABEYEjAwMDAwMDAwMDAwMDAwMDAwNgA=:failed',
    ]);
    expect(translated[1]?.command).toMatchObject({ type: MessageType.DeliveryStatusChanged, payload: { status: 'failed', errorCode: 131047 } });
    expect(translated[0]?.command.payload).not.toHaveProperty('errorCode');
  });

  it('lote misto: reação ignorada, imagem sem suporte, tipo desconhecido e estúdio desconhecido não derrubam o lote', () => {
    const { translated, ignored } = translate('mixed-batch');

    expect(translated).toHaveLength(1);
    expect(translated[0]?.command).toMatchObject({ payload: { content: { kind: 'unsupported', description: 'image' } } });
    expect(ignored.map((i) => i.reason)).toEqual(['reaction', 'malformed_item', 'unknown_tenant', 'unsupported_field']);
  });

  it('todo comando traduzido cabe no envelope do contrato', () => {
    const names = ['text-message', 'audio-voice', 'interactive-list-reply', 'interactive-button-cancel', 'flow-completion', 'statuses', 'mixed-batch'];
    for (const name of names) {
      for (const { command, correlationId } of translate(name).translated) {
        const envelope = createEnvelope(command.type, command.payload, {
          id: '7d4b0f0e-2f0a-4f43-8a3c-000000000001',
          correlationId,
          occurredAt: new Date('2026-03-02T12:00:00Z'),
        });
        expect(() => parseEnvelope(JSON.parse(JSON.stringify(envelope)))).not.toThrow();
      }
    }
  });

  it('nenhum campo da Meta vaza para o comando', () => {
    const serialized = JSON.stringify(translate('interactive-list-reply').translated);

    for (const metaField of ['messaging_product', 'wa_id', 'list_reply', 'phone_number_id', 'interactive', 'profile']) {
      expect(serialized).not.toContain(metaField);
    }
  });

  it('rejeita o que não é webhook do WhatsApp Business', () => {
    expect(() => translateWebhook({ object: 'page', entry: [] }, tenants)).toThrow(MalformedWebhook);
  });
});
