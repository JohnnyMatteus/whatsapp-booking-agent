// Testes de contrato do tradutor de saída: resposta neutra → corpo exato da Cloud API.
import type { ReplyRequested } from '@wba/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { truncate, translateReply } from '../../src/acl/outbound/translate-reply.js';
import { CLOUD_API_LIMITS } from '../../src/acl/cloud-api-types.js';

const expected = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/outbound/${name}.json`, import.meta.url), 'utf8'));

describe('ACL WhatsApp: resposta do domínio → Cloud API', () => {
  it('texto simples sem pré-visualização de link', () => {
    const reply: ReplyRequested = {
      tenantId: 'estudio-lotus',
      contactId: '5511900000001',
      content: { kind: 'text', text: 'Pronto! Sua vaga em Hatha Yoga (ter 03/03 18:00) está confirmada.' },
    };

    expect(translateReply(reply)).toEqual(expected('text'));
  });

  it('opções com horário viram lista (botão perderia a descrição), com títulos cortados no limite', () => {
    const reply: ReplyRequested = {
      tenantId: 'estudio-lotus',
      contactId: '5511900000001',
      content: {
        kind: 'choices',
        body: 'Separei as aulas desta semana para você.',
        choices: [
          { action: 'book', targetId: '01JNX0000000000000000HATHA', title: 'Hatha Yoga', description: 'ter 03/03 18:00 · com vaga' },
          { action: 'waitlist', targetId: '01JNX000000000000000PILATES', title: 'Pilates Solo Intermediário', description: 'qua 04/03 07:00 · lotada, fila 3' },
        ],
      },
    };

    expect(translateReply(reply)).toEqual(expected('slot-list'));
  });

  it('até 3 opções curtas sem descrição viram botões', () => {
    const reply: ReplyRequested = {
      tenantId: 'estudio-lotus',
      contactId: '5511900000002',
      content: {
        kind: 'choices',
        body: 'Pilates Solo (qua 04/03 07:00) está lotada. Quer entrar na lista de espera?',
        choices: [{ action: 'waitlist', targetId: '01JNX000000000000000PILATES', title: 'Entrar na fila' }],
      },
    };

    expect(translateReply(reply)).toEqual(expected('buttons'));
  });

  it('corta por caractere, sem quebrar emoji ou acento', () => {
    const value = 'Aula de Yoga Restaurativa 🧘 com respiração';

    const cut = truncate(value, CLOUD_API_LIMITS.rowTitle);

    expect([...cut]).toHaveLength(CLOUD_API_LIMITS.rowTitle);
    expect(cut.endsWith('…')).toBe(true);
  });
});
