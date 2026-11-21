// Package scheduling é o núcleo do servidor MCP: o modelo do contexto de Agendamento
// exposto às ferramentas e os casos de uso que as implementam. Não conhece HTTP nem o
// formato do SaaS; o SaaS fica atrás da porta Agenda (ACL no adaptador).
package scheduling

import "time"

// Member identifica quem pede: o estúdio e o contato do WhatsApp. A identidade no SaaS é
// resolvida pelo adaptador (TokenSource), nunca informada pelo modelo de linguagem.
type Member struct {
	Studio  string
	Contact string
}

// Situacao de uma reserva no contexto de Agendamento.
type Situacao string

const (
	SituacaoConfirmada Situacao = "confirmada"
	SituacaoEmEspera   Situacao = "em_espera"
	SituacaoCancelada  Situacao = "cancelada"
)

// Aula é uma ocorrência da grade, já no vocabulário do Agendamento.
type Aula struct {
	ID          string    `json:"id"`
	Titulo      string    `json:"titulo"`
	Instrutor   string    `json:"instrutor"`
	Inicio      time.Time `json:"inicio"`
	Fim         time.Time `json:"fim"`
	Fuso        string    `json:"fuso"`
	VagasTotais int       `json:"vagas_totais"`
	Confirmados int       `json:"confirmados"`
	Fila        int       `json:"fila"`
}

// Lotada informa se não há vaga livre.
func (a Aula) Lotada() bool { return a.Confirmados >= a.VagasTotais }

// Comecou segue a regra do SaaS: no horário de início a aula já não aceita alterações.
func (a Aula) Comecou(agora time.Time) bool { return !agora.Before(a.Inicio) }

// Reserva do aluno numa aula.
type Reserva struct {
	ID       string   `json:"id"`
	AulaID   string   `json:"aula_id"`
	Situacao Situacao `json:"situacao"`
}

// Ativa indica reserva que ocupa lugar (vaga ou fila).
func (r Reserva) Ativa() bool { return r.Situacao != SituacaoCancelada }

// MinhaReserva resume a reserva ativa do aluno numa aula listada.
type MinhaReserva struct {
	ID       string   `json:"id"`
	Situacao Situacao `json:"situacao"`
}

// AulaListada é a aula com a reserva do próprio aluno, quando houver.
type AulaListada struct {
	Aula
	MinhaReserva *MinhaReserva `json:"minha_reserva"`
}

// Cancelamento é o resultado de cancelar: a reserva e se a fila andou.
type Cancelamento struct {
	Reserva       Reserva `json:"reserva"`
	FilaPromovida bool    `json:"fila_promovida"`
}
