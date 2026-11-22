// Contrato da ACL de saída do Whatsmiau: resposta neutra → endpoint e corpo do envio.
import type { ReplyRequested } from '@wba/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateReply } from '../../src/providers/whatsmiau/acl/outbound/translate-reply.js';

const expected = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/outbound/${name}.json`, import.meta.url), 'utf8'));
const base = { tenantId: 'estudio-sol', contactId: '5511900000001' };

describe('ACL Whatsmiau: resposta do domínio → envio', () => {
  it('texto simples', () => {
    const reply: ReplyRequested = { ...base, content: { kind: 'text', text: 'Olá! Posso ajudar com aulas e reservas.' } };

    expect(translateReply(reply)).toEqual(expected('text'));
  });

  it('duas opções curtas sem descrição viram botões', () => {
    const reply: ReplyRequested = {
      ...base,
      content: {
        kind: 'choices',
        body: 'Confirmar a reserva?',
        choices: [
          { action: 'book', targetId: 'ses-1', title: 'Reservar' },
          { action: 'waitlist', targetId: 'ses-1', title: 'Lista de espera' },
        ],
      },
    };

    expect(translateReply(reply)).toEqual(expected('buttons'));
  });

  it('opções com horário na descrição viram lista', () => {
    const reply: ReplyRequested = {
      ...base,
      content: {
        kind: 'choices',
        body: 'Estas são as aulas de amanhã:',
        choices: [
          { action: 'book', targetId: 'ses-1', title: 'Hatha yoga', description: 'amanhã às 09:00, 3 vagas' },
          { action: 'book', targetId: 'ses-2', title: 'Pilates solo', description: 'amanhã às 18:30, 1 vaga' },
        ],
      },
    };

    expect(translateReply(reply)).toEqual(expected('slot-list'));
  });

  it('template vira texto com o mesmo conteúdo (o Whatsmiau não tem templates aprovados)', () => {
    const reply: ReplyRequested = { ...base, content: { kind: 'template', template: 'lembrete_aula', params: ['Hatha yoga', 'amanhã às 09:00'] } };

    expect(translateReply(reply)).toEqual(expected('template'));
  });

  it('usa os mesmos ids interativos da Cloud API, então a escolha do aluno volta como o mesmo comando', () => {
    const reply: ReplyRequested = { ...base, content: { kind: 'choices', body: 'x', choices: [{ action: 'cancel', targetId: 'bk-9', title: 'Cancelar' }] } };

    expect(JSON.stringify(translateReply(reply))).toContain('v1:cx:bk-9');
  });

  it('corta títulos e descrições da lista nos limites do WhatsApp', () => {
    const reply: ReplyRequested = {
      ...base,
      content: { kind: 'choices', body: 'x', choices: [{ action: 'book', targetId: 's', title: 'T'.repeat(40), description: 'D'.repeat(100) }] },
    };

    const out = translateReply(reply);

    expect(out.path).toBe('sendList');
    if (out.path === 'sendList') {
      expect([...(out.body.sections[0]?.rows[0]?.title ?? '')]).toHaveLength(24);
      expect([...(out.body.sections[0]?.rows[0]?.description ?? '')]).toHaveLength(72);
    }
  });
});
