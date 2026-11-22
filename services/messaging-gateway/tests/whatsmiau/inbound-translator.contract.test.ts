// Contrato da ACL do Whatsmiau: payloads anonimizados no formato documentado (Evolution API)
// precisam virar exatamente os comandos da linguagem publicada.
import { createEnvelope, MessageType, parseEnvelope } from '@wba/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MalformedWebhook } from '../../src/domain/inbound.js';
import { translateWhatsmiauWebhook, type InstanceDirectory } from '../../src/providers/whatsmiau/acl/inbound/translate-webhook.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/inbound/${name}.json`, import.meta.url), 'utf8'));
const instances: InstanceDirectory = { tenantFor: (i) => (i === 'estudio-sol' ? 'estudio-sol' : null) };
const translate = (name: string) => translateWhatsmiauWebhook(fixture(name), instances);

describe('ACL Whatsmiau: webhook → linguagem publicada', () => {
  it('texto vira MessageReceived; o número sai do JID e o estúdio da instância', () => {
    const { translated, ignored } = translate('text-message');

    expect(ignored).toEqual([]);
    expect(translated).toEqual([
      {
        dedupKey: '3EB0A0000000000000000001',
        correlationId: '3EB0A0000000000000000001',
        command: {
          type: MessageType.MessageReceived,
          payload: {
            tenantId: 'estudio-sol',
            contactId: '5511900000001',
            messageId: '3EB0A0000000000000000001',
            receivedAt: '2026-03-02T12:00:00.000Z',
            content: { kind: 'text', text: 'Quais horários tem amanhã?', transcribed: false },
          },
        },
      },
    ]);
  });

  it('áudio vira MediaReceived e o base64 embutido é devolvido para guarda temporária', () => {
    const { translated, inlineMedia } = translate('audio-base64');

    expect(translated[0]?.command).toMatchObject({
      type: MessageType.MediaReceived,
      payload: { kind: 'audio', mediaId: '3EB0A0000000000000000002', mimeType: 'audio/ogg; codecs=opus', contactId: '5511900000002' },
    });
    expect(inlineMedia).toEqual([
      { tenantId: 'estudio-sol', mediaId: '3EB0A0000000000000000002', mimeType: 'audio/ogg; codecs=opus', base64: 'T2dnUy1mYWtlLWF1ZGlv' },
    ]);
  });

  it('imagem com mediaUrl vira MediaReceived (image) guardando só a URL', () => {
    const { translated, inlineMedia } = translate('image-media-url');

    expect(translated[0]?.command).toMatchObject({ type: MessageType.MediaReceived, payload: { kind: 'image', mimeType: 'image/jpeg' } });
    expect(inlineMedia[0]).toMatchObject({ url: 'https://midia.exemplo.test/bucket/img-0003.jpg' });
    expect(inlineMedia[0]).not.toHaveProperty('base64');
  });

  it('escolha numa lista vira PedidoDeReserva com origem list', () => {
    const [item] = translate('list-reply').translated;

    expect(item?.command).toMatchObject({ type: MessageType.BookingRequested, payload: { sessionId: '01JNX0000000000000000HATHA', source: 'list' } });
  });

  it('botão de cancelar vira PedidoDeCancelamento com origem button', () => {
    const [item] = translate('buttons-reply-cancel').translated;

    expect(item?.command).toMatchObject({
      type: MessageType.CancellationRequested,
      payload: { bookingId: '01JNX0000000000000BOOKING', source: 'button' },
    });
  });

  it('messages.update vira status de entrega (DELIVERY_ACK → delivered) com chave de idempotência própria', () => {
    const [item] = translate('status-update').translated;

    expect(item).toEqual({
      dedupKey: 'status:3EB0B0000000000000000001:delivered',
      correlationId: '3EB0B0000000000000000001',
      command: {
        type: MessageType.DeliveryStatusChanged,
        payload: {
          tenantId: 'estudio-sol',
          contactId: '5511900000001',
          messageId: '3EB0B0000000000000000001',
          status: 'delivered',
          occurredAt: '2026-03-02T12:05:00.000Z',
        },
      },
    });
  });

  it.each([
    ['ignored-batch-own-message', 'own_message'],
    ['group-message', 'group_chat'],
    ['unknown-instance', 'unknown_tenant'],
    ['connection-update', 'unsupported_field'],
  ])('%s é ignorado com o motivo %s', (name, reason) => {
    const { translated, ignored } = translate(name);

    expect(translated).toEqual([]);
    expect(ignored.map((i) => i.reason)).toEqual([reason]);
  });

  it('tipo sem suporte (figurinha) vira mensagem unsupported em vez de sumir', () => {
    const [item] = translate('sticker').translated;

    expect(item?.command).toMatchObject({ payload: { content: { kind: 'unsupported', description: 'stickerMessage' } } });
  });

  it('corpo que não é um webhook do Whatsmiau é rejeitado', () => {
    expect(() => translateWhatsmiauWebhook({ foo: 1 }, instances)).toThrow(MalformedWebhook);
  });

  it('todo comando traduzido cabe no envelope do contrato', () => {
    const meta = { id: '7d4b0f0e-2f0a-4f43-8a3c-000000000099', correlationId: 'x', occurredAt: new Date('2026-03-02T12:00:00Z') };
    for (const name of ['text-message', 'audio-base64', 'image-media-url', 'list-reply', 'buttons-reply-cancel', 'status-update', 'sticker']) {
      for (const { command } of translate(name).translated) {
        expect(() => parseEnvelope(JSON.parse(JSON.stringify(createEnvelope(command.type, command.payload, meta))))).not.toThrow();
      }
    }
  });
});
