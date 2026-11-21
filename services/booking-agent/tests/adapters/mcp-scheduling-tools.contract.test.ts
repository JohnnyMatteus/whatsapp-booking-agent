// Contrato do lado TypeScript: respostas no formato do saas-mcp-server viram agregados do
// domínio, e cada código de erro das ferramentas vira o DomainError certo.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { McpSchedulingTools, McpToolProtocolError } from '../../src/adapters/mcp/scheduling-tools.js';

type Result = Awaited<ReturnType<Client['callTool']>>;
const member = { tenantId: 'estudio-lotus', contactId: '5511900000001' };

function toolsReturning(result: Result) {
  const calls: unknown[] = [];
  const tools = new McpSchedulingTools({
    callTool: async (params: unknown) => {
      calls.push(params);
      return result;
    },
  } as unknown as Pick<Client, 'callTool'>);
  return { tools, calls };
}

const aulas = {
  aulas: [
    {
      id: '01JNX0000000000000000HATHA',
      titulo: 'Hatha Yoga',
      instrutor: 'Instrutora Exemplo',
      inicio: '2026-03-03T21:00:00Z',
      fim: '2026-03-03T22:00:00Z',
      fuso: 'America/Sao_Paulo',
      vagas_totais: 12,
      confirmados: 7,
      fila: 0,
      minha_reserva: { id: '01JNY00000000000000BOOKING1', situacao: 'confirmada' },
    },
  ],
};

describe('adaptador MCP da agenda', () => {
  it('traduz listar_horarios em Aula e reserva do aluno, com identidade vinda da conversa', async () => {
    const { tools, calls } = toolsReturning({ content: [], structuredContent: aulas } as Result);

    const [listing] = await tools.listSessions(member, { from: '2026-03-03', to: '2026-03-03' });

    expect(listing?.session.title).toBe('Hatha Yoga');
    expect(listing?.session.availableSpots()).toBe(5);
    expect(listing?.myBooking).toEqual({ id: '01JNY00000000000000BOOKING1', status: 'confirmed' });
    expect(calls).toEqual([
      { name: 'listar_horarios', arguments: { de: '2026-03-03', ate: '2026-03-03', estudio: 'estudio-lotus', contato: '5511900000001' } },
    ]);
  });

  it('reaplica as invariantes do domínio sobre a resposta da ferramenta', async () => {
    const broken = { aulas: [{ ...aulas.aulas[0], confirmados: 13 }] };
    const { tools } = toolsReturning({ content: [], structuredContent: broken } as Result);

    await expect(tools.listSessions(member, { from: '2026-03-03', to: '2026-03-03' })).rejects.toMatchObject({ code: 'invalid_class_session' });
  });

  it.each([
    ['aula_lotada', 'class_session_full', false],
    ['conflito_de_horario', 'overlapping_booking', false],
    ['fora_da_janela_de_cancelamento', 'cancellation_window_closed', false],
    ['saas_indisponivel', 'scheduling_unavailable', true],
  ])('erro %s vira DomainError %s', async (codigo, code, retryable) => {
    const { tools } = toolsReturning({ isError: true, content: [{ type: 'text', text: JSON.stringify({ codigo, mensagem: 'm', retentavel: retryable }) }] } as Result);

    await expect(tools.book(member, 'ses-1')).rejects.toMatchObject({ code, retryable });
  });

  it('código desconhecido ou resposta fora do schema é erro de protocolo (conta como falha do bot)', async () => {
    const unknown = toolsReturning({ isError: true, content: [{ type: 'text', text: '{"codigo":"novo","mensagem":"m","retentavel":false}' }] } as Result);
    const malformed = toolsReturning({ content: [], structuredContent: { reserva: { id: 'x' } } } as Result);

    await expect(unknown.tools.book(member, 's')).rejects.toBeInstanceOf(McpToolProtocolError);
    await expect(malformed.tools.book(member, 's')).rejects.toBeInstanceOf(McpToolProtocolError);
  });

  it('cancelar informa se a fila andou', async () => {
    const { tools } = toolsReturning({
      content: [],
      structuredContent: { reserva: { id: 'bk-1', aula_id: 'ses-1', situacao: 'cancelada' }, fila_promovida: true },
    } as Result);

    const outcome = await tools.cancel(member, 'bk-1');

    expect(outcome.booking.status).toBe('canceled');
    expect(outcome.waitlistPromoted).toBe(true);
  });
});
