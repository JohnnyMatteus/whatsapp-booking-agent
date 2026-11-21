// Package identity resolve o token do SaaS em nome do aluno.
package identity

import (
	"context"
	"errors"
)

// ErrNoIdentity indica que o contato não tem identidade conhecida no estúdio.
var ErrNoIdentity = errors.New("contato sem identidade no estúdio")

// TokenSource devolve um bearer token válido no SaaS para o aluno (estúdio + contato).
//
// Em produção, a implementação prevista é token exchange (RFC 8693) no Keycloak a partir do
// vínculo telefone → aluno (ver docs/design-doc.md, Próximos passos). Nesta fundação existe
// só o StaticTokenSource, para desenvolvimento.
type TokenSource interface {
	Token(ctx context.Context, studio, contact string) (string, error)
}

// StaticTokenSource usa um token fixo por estúdio (desenvolvimento e testes).
type StaticTokenSource struct {
	tokens map[string]string
}

// NewStaticTokenSource cria a fonte a partir do mapa estúdio → token.
func NewStaticTokenSource(tokens map[string]string) *StaticTokenSource {
	return &StaticTokenSource{tokens: tokens}
}

// Token devolve o token do estúdio ou ErrNoIdentity.
func (s *StaticTokenSource) Token(_ context.Context, studio, _ string) (string, error) {
	token, ok := s.tokens[studio]
	if !ok || token == "" {
		return "", ErrNoIdentity
	}
	return token, nil
}
