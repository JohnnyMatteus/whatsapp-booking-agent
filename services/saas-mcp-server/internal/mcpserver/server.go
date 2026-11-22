// Package mcpserver expõe os casos de uso de Agendamento como ferramentas MCP
// (listar_horarios, reservar, cancelar, entrar_lista_espera).
package mcpserver

import (
	"context"
	"log/slog"
	"time"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Nomes das ferramentas: contrato com o booking-agent.
const (
	ToolListarHorarios    = "listar_horarios"
	ToolReservar          = "reservar"
	ToolCancelar          = "cancelar"
	ToolEntrarListaEspera = "entrar_lista_espera"
	ToolVincularContato   = "vincular_contato"
)

// Versão do servidor anunciada no handshake MCP.
const Version = "0.1.0"

// ToolObserver recebe o resultado de cada chamada (métricas).
type ToolObserver func(tool, result string, elapsed time.Duration)

// Identidade preenchida pelo código do agente a partir da conversa, nunca pelo modelo.
type member struct {
	Estudio string `json:"estudio" jsonschema:"slug do estúdio (tenant)"`
	Contato string `json:"contato" jsonschema:"identificador do contato no WhatsApp"`
}

type listarHorariosIn struct {
	member
	De  string `json:"de" jsonschema:"data local inicial, AAAA-MM-DD"`
	Ate string `json:"ate" jsonschema:"data local final, AAAA-MM-DD (inclusiva)"`
}

type listarHorariosOut struct {
	Aulas []scheduling.AulaListada `json:"aulas"`
}

type aulaIn struct {
	member
	AulaID string `json:"aula_id" jsonschema:"id da aula devolvido por listar_horarios"`
}

type cancelarIn struct {
	member
	ReservaID string `json:"reserva_id" jsonschema:"id da reserva do aluno"`
}

type vincularIn struct {
	member
	Codigo string `json:"codigo" jsonschema:"código de 6 dígitos gerado pelo aluno no SaaS"`
}

type reservaOut struct {
	Reserva scheduling.Reserva `json:"reserva"`
}

// New registra as cinco ferramentas sobre o serviço de Agendamento.
func New(svc *scheduling.Service, logger *slog.Logger, observe ToolObserver) *mcp.Server {
	if observe == nil {
		observe = func(string, string, time.Duration) {}
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "saas-mcp-server", Version: Version}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolListarHorarios,
		Description: "Lista as aulas do estúdio num intervalo de datas locais, com vagas, fila e a reserva do próprio aluno.",
	}, instrument(ToolListarHorarios, logger, observe, func(ctx context.Context, in listarHorariosIn) (listarHorariosOut, error) {
		aulas, err := svc.ListarHorarios(ctx, in.toMember(), in.De, in.Ate)
		return listarHorariosOut{Aulas: aulas}, err
	}))

	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolReservar,
		Description: "Reserva vaga numa aula com lugar. Aula lotada devolve o erro aula_lotada.",
	}, instrument(ToolReservar, logger, observe, func(ctx context.Context, in aulaIn) (reservaOut, error) {
		reserva, err := svc.Reservar(ctx, in.toMember(), in.AulaID)
		return reservaOut{Reserva: reserva}, err
	}))

	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolCancelar,
		Description: "Cancela uma reserva do aluno; informa se alguém da fila foi promovido.",
	}, instrument(ToolCancelar, logger, observe, func(ctx context.Context, in cancelarIn) (scheduling.Cancelamento, error) {
		return svc.Cancelar(ctx, in.toMember(), in.ReservaID)
	}))

	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolEntrarListaEspera,
		Description: "Coloca o aluno na lista de espera de uma aula lotada. Aula com vaga devolve o erro ha_vagas.",
	}, instrument(ToolEntrarListaEspera, logger, observe, func(ctx context.Context, in aulaIn) (reservaOut, error) {
		reserva, err := svc.EntrarListaEspera(ctx, in.toMember(), in.AulaID)
		return reservaOut{Reserva: reserva}, err
	}))

	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolVincularContato,
		Description: "Vincula o telefone do contato ao aluno que gerou o código de 6 dígitos no SaaS (opt-in).",
	}, instrument(ToolVincularContato, logger, observe, func(ctx context.Context, in vincularIn) (scheduling.VinculoConfirmado, error) {
		return svc.VincularContato(ctx, in.toMember(), in.Codigo)
	}))

	return server
}

func (m member) toMember() scheduling.Member {
	return scheduling.Member{Studio: m.Estudio, Contact: m.Contato}
}

// instrument adapta o caso de uso para o handler MCP: erro de domínio vira resultado com
// isError=true e JSON {codigo, mensagem, retentavel}; qualquer outro erro vira
// erro_inesperado, sem detalhes internos.
func instrument[In, Out any](tool string, logger *slog.Logger, observe ToolObserver, fn func(context.Context, In) (Out, error)) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		start := time.Now()
		out, err := fn(ctx, in)
		if err == nil {
			observe(tool, "ok", time.Since(start))
			return nil, out, nil
		}
		var zero Out
		domainErr, ok := scheduling.AsError(err)
		if !ok {
			logger.ErrorContext(ctx, "tool_unexpected_error", "tool", tool, "error", err.Error())
			domainErr = scheduling.NewError(scheduling.CodeErroInesperado, "erro inesperado no servidor de agenda")
		}
		observe(tool, string(domainErr.Code), time.Since(start))
		logger.InfoContext(ctx, "tool_domain_error", "tool", tool, "code", domainErr.Code, "retryable", domainErr.Retryable)
		return nil, zero, domainErr
	}
}
