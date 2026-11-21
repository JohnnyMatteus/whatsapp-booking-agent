package scheduling

import (
	"context"
	"testing"
	"time"
)

var now = time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC)
var aluno = Member{Studio: "estudio-lotus", Contact: "5511900000001"}

type fakeAgenda struct {
	aulas    map[string]Aula
	reservas []Reserva
	booked   []string
	bookAs   Situacao
}

func (f *fakeAgenda) ListSessions(context.Context, Member, string, string) ([]Aula, error) {
	out := make([]Aula, 0, len(f.aulas))
	for _, id := range []string{"hatha", "pilates", "passada"} {
		if a, ok := f.aulas[id]; ok {
			out = append(out, a)
		}
	}
	return out, nil
}

func (f *fakeAgenda) GetSession(_ context.Context, _ Member, id string) (Aula, error) {
	a, ok := f.aulas[id]
	if !ok {
		return Aula{}, NewError(CodeNaoEncontrado, "aula não encontrada")
	}
	return a, nil
}

func (f *fakeAgenda) MyBookings(context.Context, Member) ([]Reserva, error) { return f.reservas, nil }

func (f *fakeAgenda) Book(_ context.Context, _ Member, id string) (Reserva, error) {
	f.booked = append(f.booked, id)
	return Reserva{ID: "nova", AulaID: id, Situacao: f.bookAs}, nil
}

func (f *fakeAgenda) Cancel(_ context.Context, _ Member, id string) (Cancelamento, error) {
	return Cancelamento{Reserva: Reserva{ID: id, Situacao: SituacaoCancelada}}, nil
}

func newFake() *fakeAgenda {
	inicio := now.Add(24 * time.Hour)
	return &fakeAgenda{
		bookAs: SituacaoConfirmada,
		aulas: map[string]Aula{
			"hatha":   {ID: "hatha", Inicio: inicio, Fim: inicio.Add(time.Hour), VagasTotais: 10, Confirmados: 4},
			"pilates": {ID: "pilates", Inicio: inicio, Fim: inicio.Add(time.Hour), VagasTotais: 8, Confirmados: 8, Fila: 2},
			"passada": {ID: "passada", Inicio: now.Add(-time.Hour), Fim: now, VagasTotais: 8, Confirmados: 1},
		},
	}
}

func service(f *fakeAgenda) *Service { return NewService(f, func() time.Time { return now }) }

func code(t *testing.T, err error) Code {
	t.Helper()
	e, ok := AsError(err)
	if !ok {
		t.Fatalf("esperava erro de domínio, veio %v", err)
	}
	return e.Code
}

func TestListarHorariosJuntaReservaAtivaDoAluno(t *testing.T) {
	f := newFake()
	f.reservas = []Reserva{
		{ID: "r1", AulaID: "hatha", Situacao: SituacaoConfirmada},
		{ID: "r2", AulaID: "pilates", Situacao: SituacaoCancelada},
	}

	aulas, err := service(f).ListarHorarios(context.Background(), aluno, "2026-03-02", "2026-03-08")
	if err != nil {
		t.Fatal(err)
	}

	if aulas[0].MinhaReserva == nil || aulas[0].MinhaReserva.ID != "r1" {
		t.Errorf("hatha deveria ter a reserva r1: %+v", aulas[0].MinhaReserva)
	}
	if aulas[1].MinhaReserva != nil {
		t.Error("reserva cancelada não deve aparecer como minha reserva")
	}
}

func TestListarHorariosValidaIntervalo(t *testing.T) {
	for _, tc := range [][2]string{{"02/03/2026", "2026-03-08"}, {"2026-03-08", "2026-03-02"}, {"", ""}} {
		_, err := service(newFake()).ListarHorarios(context.Background(), aluno, tc[0], tc[1])
		if code(t, err) != CodeEntradaInvalida {
			t.Errorf("%v: esperava entrada_invalida", tc)
		}
	}
}

func TestReservar(t *testing.T) {
	t.Run("aula com vaga reserva", func(t *testing.T) {
		f := newFake()
		reserva, err := service(f).Reservar(context.Background(), aluno, "hatha")
		if err != nil || reserva.Situacao != SituacaoConfirmada {
			t.Fatalf("reserva=%+v err=%v", reserva, err)
		}
	})
	t.Run("aula lotada não vira fila sem o aluno pedir", func(t *testing.T) {
		f := newFake()
		_, err := service(f).Reservar(context.Background(), aluno, "pilates")
		if code(t, err) != CodeAulaLotada || len(f.booked) != 0 {
			t.Errorf("err=%v booked=%v", err, f.booked)
		}
	})
	t.Run("aula começada", func(t *testing.T) {
		_, err := service(newFake()).Reservar(context.Background(), aluno, "passada")
		if code(t, err) != CodeAulaJaComecou {
			t.Error(err)
		}
	})
	t.Run("última vaga acabou no meio do caminho: repassa em_espera", func(t *testing.T) {
		f := newFake()
		f.bookAs = SituacaoEmEspera
		reserva, err := service(f).Reservar(context.Background(), aluno, "hatha")
		if err != nil || reserva.Situacao != SituacaoEmEspera {
			t.Errorf("reserva=%+v err=%v", reserva, err)
		}
	})
}

func TestEntrarListaEspera(t *testing.T) {
	t.Run("aula lotada entra na fila", func(t *testing.T) {
		f := newFake()
		f.bookAs = SituacaoEmEspera
		reserva, err := service(f).EntrarListaEspera(context.Background(), aluno, "pilates")
		if err != nil || reserva.Situacao != SituacaoEmEspera {
			t.Errorf("reserva=%+v err=%v", reserva, err)
		}
	})
	t.Run("aula com vaga recusa a fila", func(t *testing.T) {
		f := newFake()
		_, err := service(f).EntrarListaEspera(context.Background(), aluno, "hatha")
		if code(t, err) != CodeHaVagas || len(f.booked) != 0 {
			t.Errorf("err=%v booked=%v", err, f.booked)
		}
	})
	t.Run("aula inexistente", func(t *testing.T) {
		_, err := service(newFake()).EntrarListaEspera(context.Background(), aluno, "nao-existe")
		if code(t, err) != CodeNaoEncontrado {
			t.Error(err)
		}
	})
}

func TestCancelarExigeReserva(t *testing.T) {
	_, err := service(newFake()).Cancelar(context.Background(), aluno, "")
	if code(t, err) != CodeEntradaInvalida {
		t.Error(err)
	}
}

func (f *fakeAgenda) ConfirmLink(context.Context, Member, string) (VinculoConfirmado, error) {
	return VinculoConfirmado{Nome: "Aluna Exemplo"}, nil
}
