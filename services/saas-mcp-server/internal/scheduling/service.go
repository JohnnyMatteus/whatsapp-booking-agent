package scheduling

import (
	"context"
	"regexp"
	"time"
)

// Agenda é a porta de saída para o sistema de agenda (o SaaS). O adaptador traduz o modelo
// do SaaS para o do Agendamento e os erros do SaaS para *Error (Anti-Corruption Layer).
type Agenda interface {
	ListSessions(ctx context.Context, m Member, from, to string) ([]Aula, error)
	GetSession(ctx context.Context, m Member, sessionID string) (Aula, error)
	MyBookings(ctx context.Context, m Member) ([]Reserva, error)
	Book(ctx context.Context, m Member, sessionID string) (Reserva, error)
	Cancel(ctx context.Context, m Member, bookingID string) (Cancelamento, error)
}

// Service implementa as quatro ferramentas sobre a porta Agenda.
type Service struct {
	agenda Agenda
	now    func() time.Time
}

// NewService cria o serviço; now é injetável para testes.
func NewService(agenda Agenda, now func() time.Time) *Service {
	return &Service{agenda: agenda, now: now}
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ListarHorarios devolve as aulas do intervalo com a reserva ativa do aluno em cada uma.
func (s *Service) ListarHorarios(ctx context.Context, m Member, de, ate string) ([]AulaListada, error) {
	if !isoDate.MatchString(de) || !isoDate.MatchString(ate) || ate < de {
		return nil, NewError(CodeEntradaInvalida, "intervalo de datas inválido (use AAAA-MM-DD, de <= ate)")
	}
	aulas, err := s.agenda.ListSessions(ctx, m, de, ate)
	if err != nil {
		return nil, err
	}
	reservas, err := s.agenda.MyBookings(ctx, m)
	if err != nil {
		return nil, err
	}
	minhas := make(map[string]MinhaReserva, len(reservas))
	for _, r := range reservas {
		if r.Ativa() {
			minhas[r.AulaID] = MinhaReserva{ID: r.ID, Situacao: r.Situacao}
		}
	}
	listadas := make([]AulaListada, 0, len(aulas))
	for _, a := range aulas {
		item := AulaListada{Aula: a}
		if r, ok := minhas[a.ID]; ok {
			item.MinhaReserva = &r
		}
		listadas = append(listadas, item)
	}
	return listadas, nil
}

// Reservar pede vaga numa aula com lugar. Aula lotada vira erro explícito: entrar na fila
// é outra decisão do aluno (o SaaS colocaria na fila sem perguntar).
func (s *Service) Reservar(ctx context.Context, m Member, aulaID string) (Reserva, error) {
	aula, err := s.agenda.GetSession(ctx, m, aulaID)
	if err != nil {
		return Reserva{}, err
	}
	if aula.Comecou(s.now()) {
		return Reserva{}, NewError(CodeAulaJaComecou, "a aula já começou")
	}
	if aula.Lotada() {
		return Reserva{}, NewError(CodeAulaLotada, "a aula está lotada; ofereça a lista de espera")
	}
	// Entre a consulta e a reserva a última vaga pode acabar: aí o SaaS devolve em_espera,
	// e a ferramenta repassa essa situação em vez de esconder.
	return s.agenda.Book(ctx, m, aulaID)
}

// Cancelar cancela uma reserva do aluno.
func (s *Service) Cancelar(ctx context.Context, m Member, reservaID string) (Cancelamento, error) {
	if reservaID == "" {
		return Cancelamento{}, NewError(CodeEntradaInvalida, "reserva_id é obrigatório")
	}
	return s.agenda.Cancel(ctx, m, reservaID)
}

// EntrarListaEspera coloca o aluno na fila de uma aula lotada. O SaaS não tem endpoint
// próprio de fila: a reserva numa aula lotada é que vira posição na fila.
func (s *Service) EntrarListaEspera(ctx context.Context, m Member, aulaID string) (Reserva, error) {
	aula, err := s.agenda.GetSession(ctx, m, aulaID)
	if err != nil {
		return Reserva{}, err
	}
	if aula.Comecou(s.now()) {
		return Reserva{}, NewError(CodeAulaJaComecou, "a aula já começou")
	}
	if !aula.Lotada() {
		return Reserva{}, NewError(CodeHaVagas, "a aula tem vaga; faça a reserva direto")
	}
	// Se uma vaga abrir entre a consulta e o pedido, o SaaS confirma: melhor para o aluno.
	return s.agenda.Book(ctx, m, aulaID)
}
