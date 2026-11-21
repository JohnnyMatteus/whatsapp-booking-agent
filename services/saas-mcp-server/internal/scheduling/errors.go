package scheduling

import (
	"encoding/json"
	"errors"
)

// Code é o código estável de erro de domínio devolvido pelas ferramentas.
type Code string

const (
	CodeAulaLotada       Code = "aula_lotada"
	CodeHaVagas          Code = "ha_vagas"
	CodeAulaJaComecou    Code = "aula_ja_comecou"
	CodeReservaDuplicada Code = "reserva_duplicada"
	CodeConflitoHorario  Code = "conflito_de_horario"
	CodeForaDaJanela     Code = "fora_da_janela_de_cancelamento"
	CodeReservaCancelada Code = "reserva_ja_cancelada"
	CodeNaoEncontrado    Code = "nao_encontrado"
	CodeAcessoNegado     Code = "acesso_negado"
	CodeEntradaInvalida  Code = "entrada_invalida"
	CodeSaasIndisponivel Code = "saas_indisponivel"
	CodeErroInesperado   Code = "erro_inesperado"
)

// Error é um erro de domínio do Agendamento. Error() devolve JSON para que o cliente MCP
// leia código e retentabilidade do conteúdo do resultado com isError=true.
type Error struct {
	Code      Code   `json:"codigo"`
	Message   string `json:"mensagem"`
	Retryable bool   `json:"retentavel"`
}

func (e *Error) Error() string {
	b, _ := json.Marshal(e)
	return string(b)
}

// NewError cria um erro de domínio não retentável.
func NewError(code Code, message string) *Error {
	return &Error{Code: code, Message: message}
}

// Unavailable cria o erro retentável de indisponibilidade do SaaS.
func Unavailable(message string) *Error {
	return &Error{Code: CodeSaasIndisponivel, Message: message, Retryable: true}
}

// AsError extrai o erro de domínio de uma cadeia de erros.
func AsError(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}
