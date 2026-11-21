package saas

import (
	"fmt"
	"net/http"
	"time"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
)

// Tradutores da ACL do SaaS. Cada mapeamento é explícito: um valor novo do SaaS (status ou
// tipo de erro) cai num caso conhecido e testado, nunca passa adiante sem tradução.

func toAula(r sessionResource) (scheduling.Aula, error) {
	inicio, err := time.Parse(time.RFC3339, r.StartsAt)
	if err != nil {
		return scheduling.Aula{}, fmt.Errorf("starts_at inválido na aula %s: %w", r.ID, err)
	}
	fim, err := time.Parse(time.RFC3339, r.EndsAt)
	if err != nil {
		return scheduling.Aula{}, fmt.Errorf("ends_at inválido na aula %s: %w", r.ID, err)
	}
	if r.ID == "" || r.Capacity < 1 || r.ConfirmedCount < 0 || r.WaitlistCount < 0 {
		return scheduling.Aula{}, fmt.Errorf("aula %q com contagens inválidas", r.ID)
	}
	return scheduling.Aula{
		ID:          r.ID,
		Titulo:      r.Title,
		Instrutor:   r.Instructor.Name,
		Inicio:      inicio.UTC(),
		Fim:         fim.UTC(),
		Fuso:        r.Timezone,
		VagasTotais: r.Capacity,
		// O SaaS calcula available_spots com max(0, ...); a fonte da verdade é confirmed_count.
		Confirmados: min(r.ConfirmedCount, r.Capacity),
		Fila:        r.WaitlistCount,
	}, nil
}

var situacaoBySaaSStatus = map[string]scheduling.Situacao{
	"confirmed":  scheduling.SituacaoConfirmada,
	"waitlisted": scheduling.SituacaoEmEspera,
	"canceled":   scheduling.SituacaoCancelada,
}

func toReserva(r bookingResource) (scheduling.Reserva, error) {
	situacao, ok := situacaoBySaaSStatus[r.Status]
	if !ok {
		return scheduling.Reserva{}, fmt.Errorf("status de reserva desconhecido no SaaS: %q", r.Status)
	}
	return scheduling.Reserva{ID: r.ID, AulaID: r.SessionID, Situacao: situacao}, nil
}

// errorBySaaSType mapeia o "type" estável do problem+json do SaaS para o erro de domínio.
var errorBySaaSType = map[string]scheduling.Code{
	"already_booked":                scheduling.CodeReservaDuplicada,
	"overlapping_booking":           scheduling.CodeConflitoHorario,
	"session_already_started":       scheduling.CodeAulaJaComecou,
	"cancellation_window_closed":    scheduling.CodeForaDaJanela,
	"booking_already_canceled":      scheduling.CodeReservaCancelada,
	"not_found":                     scheduling.CodeNaoEncontrado,
	"unauthenticated":               scheduling.CodeAcessoNegado,
	"forbidden":                     scheduling.CodeAcessoNegado,
	"tenant_not_recognized":         scheduling.CodeAcessoNegado,
	"role_not_recognized":           scheduling.CodeAcessoNegado,
	"validation_failed":             scheduling.CodeEntradaInvalida,
	"whatsapp_contact_not_linked":   scheduling.CodeNaoVinculado,
	"invalid_link_code":             scheduling.CodeCodigoInvalido,
	"whatsapp_agent_required":       scheduling.CodeAcessoNegado,
	"identity_provider_unavailable": scheduling.CodeSaasIndisponivel,
}

var messageByCode = map[scheduling.Code]string{
	scheduling.CodeReservaDuplicada: "o aluno já tem reserva nesta aula",
	scheduling.CodeConflitoHorario:  "o aluno já tem outra aula no mesmo horário",
	scheduling.CodeAulaJaComecou:    "a aula já começou",
	scheduling.CodeForaDaJanela:     "o prazo de cancelamento do estúdio já passou",
	scheduling.CodeReservaCancelada: "a reserva já estava cancelada",
	scheduling.CodeNaoEncontrado:    "aula ou reserva não encontrada",
	scheduling.CodeAcessoNegado:     "o aluno não tem acesso a esta operação no estúdio",
	scheduling.CodeEntradaInvalida:  "parâmetros recusados pelo sistema de agenda",
	scheduling.CodeNaoVinculado:     "este telefone ainda não está vinculado a um aluno; peça o código de vínculo",
	scheduling.CodeCodigoInvalido:   "código de vínculo inválido, expirado ou já usado",
	scheduling.CodeSaasIndisponivel: "sistema de agenda indisponível",
}

// toDomainError traduz uma resposta de erro do SaaS. O detail do SaaS não é repassado:
// pode mudar de texto a qualquer momento e não é contrato.
func toDomainError(status int, p *problem) *scheduling.Error {
	if status >= http.StatusInternalServerError || status == http.StatusTooManyRequests {
		return scheduling.Unavailable(fmt.Sprintf("sistema de agenda respondeu %d", status))
	}
	if p != nil {
		if code, ok := errorBySaaSType[p.Type]; ok {
			if code == scheduling.CodeSaasIndisponivel {
				return scheduling.Unavailable(messageByCode[code])
			}
			return scheduling.NewError(code, messageByCode[code])
		}
	}
	if status == http.StatusNotFound {
		return scheduling.NewError(scheduling.CodeNaoEncontrado, messageByCode[scheduling.CodeNaoEncontrado])
	}
	return scheduling.NewError(scheduling.CodeErroInesperado, fmt.Sprintf("resposta %d sem tradução conhecida", status))
}
