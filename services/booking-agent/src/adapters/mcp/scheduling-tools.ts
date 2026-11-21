// Adaptador da porta SchedulingTools sobre o servidor MCP (saas-mcp-server).
//
// Segunda barreira da ACL do SaaS: o servidor MCP já fala Agendamento, mas a resposta é
// validada por schema e reconstruída como agregados do domínio (as invariantes rodam de novo),
// e cada código de erro das ferramentas tem um mapeamento explícito para DomainError.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import type { CancellationOutcome, DateRange, MemberContext, SchedulingTools, SessionListing } from '../../application/ports.js';
import { Booking, type BookingStatus } from '../../domain/booking.js';
import { ClassSession } from '../../domain/class-session.js';
import { DomainError, type DomainErrorCode } from '../../domain/errors.js';

const Situacao = z.enum(['confirmada', 'em_espera', 'cancelada']);
const STATUS: Record<z.infer<typeof Situacao>, BookingStatus> = { confirmada: 'confirmed', em_espera: 'waitlisted', cancelada: 'canceled' };

const Aula = z.object({
  id: z.string(),
  titulo: z.string(),
  instrutor: z.string(),
  inicio: z.iso.datetime({ offset: true }),
  fim: z.iso.datetime({ offset: true }),
  fuso: z.string(),
  vagas_totais: z.number().int(),
  confirmados: z.number().int(),
  fila: z.number().int(),
  minha_reserva: z.object({ id: z.string(), situacao: z.enum(['confirmada', 'em_espera']) }).nullable(),
});
const Reserva = z.object({ id: z.string(), aula_id: z.string(), situacao: Situacao });

const ListarHorariosOut = z.object({ aulas: z.array(Aula) });
const ReservaOut = z.object({ reserva: Reserva });
const CancelarOut = z.object({ reserva: Reserva, fila_promovida: z.boolean() });
const ToolError = z.object({ codigo: z.string(), mensagem: z.string(), retentavel: z.boolean() });

/** Mapa explícito: código da ferramenta → erro de domínio. Código desconhecido é falha, não regra. */
const ERROR_BY_CODE: Record<string, DomainErrorCode> = {
  aula_lotada: 'class_session_full',
  ha_vagas: 'seats_available',
  aula_ja_comecou: 'class_session_started',
  reserva_duplicada: 'already_booked',
  conflito_de_horario: 'overlapping_booking',
  fora_da_janela_de_cancelamento: 'cancellation_window_closed',
  reserva_ja_cancelada: 'booking_already_canceled',
  nao_encontrado: 'not_found',
  acesso_negado: 'access_denied',
  entrada_invalida: 'invalid_request',
  saas_indisponivel: 'scheduling_unavailable',
};

export class McpToolProtocolError extends Error {
  constructor(tool: string, detail: string) {
    super(`Resposta da ferramenta ${tool} fora do contrato: ${detail}`);
    this.name = 'McpToolProtocolError';
  }
}

type CallTool = Pick<Client, 'callTool'>;

export class McpSchedulingTools implements SchedulingTools {
  constructor(private readonly client: CallTool) {}

  async listSessions(member: MemberContext, range: DateRange): Promise<readonly SessionListing[]> {
    const out = await this.call('listar_horarios', member, { de: range.from, ate: range.to }, ListarHorariosOut);
    return out.aulas.map((aula) => ({
      session: ClassSession.create({
        id: aula.id,
        title: aula.titulo,
        instructorName: aula.instrutor,
        startsAt: new Date(aula.inicio),
        endsAt: new Date(aula.fim),
        timezone: aula.fuso,
        capacity: aula.vagas_totais,
        confirmedCount: aula.confirmados,
        waitlistCount: aula.fila,
      }),
      myBooking: aula.minha_reserva ? { id: aula.minha_reserva.id, status: aula.minha_reserva.situacao === 'confirmada' ? 'confirmed' : 'waitlisted' } : null,
    }));
  }

  async book(member: MemberContext, sessionId: string): Promise<Booking> {
    const out = await this.call('reservar', member, { aula_id: sessionId }, ReservaOut);
    return toBooking(out.reserva);
  }

  async cancel(member: MemberContext, bookingId: string): Promise<CancellationOutcome> {
    const out = await this.call('cancelar', member, { reserva_id: bookingId }, CancelarOut);
    return { booking: toBooking(out.reserva), waitlistPromoted: out.fila_promovida };
  }

  async joinWaitlist(member: MemberContext, sessionId: string): Promise<Booking> {
    const out = await this.call('entrar_lista_espera', member, { aula_id: sessionId }, ReservaOut);
    return toBooking(out.reserva);
  }

  private async call<T>(tool: string, member: MemberContext, args: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    // Identidade sempre vinda da conversa: o LLM nunca preenche estes campos.
    const result = await this.client.callTool({ name: tool, arguments: { ...args, estudio: member.tenantId, contato: member.contactId } });
    if (result.isError) throw toDomainError(tool, result.content);
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) throw new McpToolProtocolError(tool, parsed.error.issues.map((i) => i.path.join('.')).join(', '));
    return parsed.data;
  }
}

function toBooking(reserva: z.infer<typeof Reserva>): Booking {
  return Booking.create({ id: reserva.id, sessionId: reserva.aula_id, status: STATUS[reserva.situacao] });
}

function toDomainError(tool: string, content: unknown): Error {
  const text = Array.isArray(content) ? (content as { type?: string; text?: string }[]).find((c) => c.type === 'text')?.text : undefined;
  const parsed = parseToolError(text);
  if (!parsed) return new McpToolProtocolError(tool, 'erro sem o formato {codigo, mensagem, retentavel}');
  const code = ERROR_BY_CODE[parsed.codigo];
  if (!code) return new McpToolProtocolError(tool, `código desconhecido ${parsed.codigo}`);
  return new DomainError(code, parsed.mensagem, parsed.retentavel);
}

function parseToolError(text: string | undefined): z.infer<typeof ToolError> | null {
  try {
    const candidate = ToolError.safeParse(JSON.parse(text ?? ''));
    return candidate.success ? candidate.data : null;
  } catch {
    return null;
  }
}
