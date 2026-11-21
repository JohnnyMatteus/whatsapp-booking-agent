package identity

import (
	"context"
	"fmt"
	"net/url"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

// ClientCredentials descreve o client confidencial do agente num estúdio (conta de serviço).
type ClientCredentials struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// ClientCredentialsSource obtém, por estúdio, o token da conta de serviço do agente no
// Keycloak (grant client_credentials). O token sozinho não acessa nada do domínio: quem
// escolhe o aluno é o header de contato, validado pelo SaaS contra o vínculo (ADR 0009).
// O oauth2.ReuseTokenSource guarda o token até perto de expirar.
type ClientCredentialsSource struct {
	sources map[string]oauth2.TokenSource
}

// NewClientCredentialsSource cria a fonte; tokenURL é o endpoint de token do realm.
func NewClientCredentialsSource(tokenURL string, clients map[string]ClientCredentials) (*ClientCredentialsSource, error) {
	if _, err := url.ParseRequestURI(tokenURL); err != nil {
		return nil, fmt.Errorf("SAAS_TOKEN_URL inválida: %w", err)
	}
	sources := make(map[string]oauth2.TokenSource, len(clients))
	for studio, c := range clients {
		cfg := clientcredentials.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, TokenURL: tokenURL}
		// Contexto de fundo: a renovação não pode morrer com a requisição que a disparou.
		sources[studio] = cfg.TokenSource(context.Background())
	}
	return &ClientCredentialsSource{sources: sources}, nil
}

// Token devolve o token do estúdio ou ErrNoIdentity quando o estúdio não tem client.
func (s *ClientCredentialsSource) Token(_ context.Context, studio, _ string) (string, error) {
	src, ok := s.sources[studio]
	if !ok {
		return "", ErrNoIdentity
	}
	tok, err := src.Token()
	if err != nil {
		return "", fmt.Errorf("token da conta de serviço: %w", err)
	}
	return tok.AccessToken, nil
}
