package saas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/identity"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
)

const (
	maxPages     = 10
	perPage      = 100
	maxBodyBytes = 1 << 20
)

// RequestObserver recebe a duração de cada chamada ao SaaS (métricas).
type RequestObserver func(route string, status int, elapsed time.Duration)

// Client implementa scheduling.Agenda sobre a API REST v1 do SaaS.
type Client struct {
	baseURL *url.URL
	http    *http.Client
	tokens  identity.TokenSource
	observe RequestObserver
}

// NewClient cria o cliente. baseURL é a raiz da API (ex.: http://saas:8000/api).
func NewClient(baseURL string, httpClient *http.Client, tokens identity.TokenSource, observe RequestObserver) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return nil, fmt.Errorf("SAAS_BASE_URL inválida: %w", err)
	}
	if observe == nil {
		observe = func(string, int, time.Duration) {}
	}
	return &Client{baseURL: u, http: httpClient, tokens: tokens, observe: observe}, nil
}

var _ scheduling.Agenda = (*Client)(nil)

// ListSessions percorre as páginas da grade do intervalo.
func (c *Client) ListSessions(ctx context.Context, m scheduling.Member, from, to string) ([]scheduling.Aula, error) {
	var aulas []scheduling.Aula
	for page := 1; page <= maxPages; page++ {
		q := url.Values{"from": {from}, "to": {to}, "per_page": {fmt.Sprint(perPage)}, "page": {fmt.Sprint(page)}}
		var body sessionPage
		if err := c.do(ctx, m, http.MethodGet, "/v1/sessions", "sessions.index", q, &body); err != nil {
			return nil, err
		}
		for _, r := range body.Data {
			aula, err := toAula(r)
			if err != nil {
				return nil, scheduling.Unavailable(err.Error())
			}
			aulas = append(aulas, aula)
		}
		if body.Meta.LastPage <= page {
			return aulas, nil
		}
	}
	return aulas, nil
}

// GetSession busca uma aula.
func (c *Client) GetSession(ctx context.Context, m scheduling.Member, sessionID string) (scheduling.Aula, error) {
	var body sessionEnvelope
	if err := c.do(ctx, m, http.MethodGet, "/v1/sessions/"+url.PathEscape(sessionID), "sessions.show", nil, &body); err != nil {
		return scheduling.Aula{}, err
	}
	aula, err := toAula(body.Data)
	if err != nil {
		return scheduling.Aula{}, scheduling.Unavailable(err.Error())
	}
	return aula, nil
}

// MyBookings lista as reservas do aluno (a primeira página basta: o SaaS ordena pelas
// próximas aulas, e a listagem do bot cobre no máximo 31 dias).
func (c *Client) MyBookings(ctx context.Context, m scheduling.Member) ([]scheduling.Reserva, error) {
	var body bookingPage
	if err := c.do(ctx, m, http.MethodGet, "/v1/me/bookings", "me.bookings", nil, &body); err != nil {
		return nil, err
	}
	reservas := make([]scheduling.Reserva, 0, len(body.Data))
	for _, r := range body.Data {
		reserva, err := toReserva(r)
		if err != nil {
			return nil, scheduling.Unavailable(err.Error())
		}
		reservas = append(reservas, reserva)
	}
	return reservas, nil
}

// Book cria a reserva (vaga ou fila, decisão do SaaS).
func (c *Client) Book(ctx context.Context, m scheduling.Member, sessionID string) (scheduling.Reserva, error) {
	var body bookingEnvelope
	if err := c.do(ctx, m, http.MethodPost, "/v1/sessions/"+url.PathEscape(sessionID)+"/bookings", "sessions.bookings.store", nil, &body); err != nil {
		return scheduling.Reserva{}, err
	}
	reserva, err := toReserva(body.Data)
	if err != nil {
		return scheduling.Reserva{}, scheduling.Unavailable(err.Error())
	}
	return reserva, nil
}

// Cancel cancela a reserva; o SaaS informa se alguém da fila foi promovido.
func (c *Client) Cancel(ctx context.Context, m scheduling.Member, bookingID string) (scheduling.Cancelamento, error) {
	var body cancellationEnvelope
	if err := c.do(ctx, m, http.MethodPost, "/v1/bookings/"+url.PathEscape(bookingID)+"/cancel", "bookings.cancel", nil, &body); err != nil {
		return scheduling.Cancelamento{}, err
	}
	reserva, err := toReserva(body.Data.Canceled)
	if err != nil {
		return scheduling.Cancelamento{}, scheduling.Unavailable(err.Error())
	}
	return scheduling.Cancelamento{Reserva: reserva, FilaPromovida: body.Data.Promoted != nil}, nil
}

func (c *Client) do(ctx context.Context, m scheduling.Member, method, path, route string, query url.Values, out any) error {
	token, err := c.tokens.Token(ctx, m.Studio, m.Contact)
	if errors.Is(err, identity.ErrNoIdentity) {
		return scheduling.NewError(scheduling.CodeAcessoNegado, "contato sem cadastro no estúdio")
	}
	if err != nil {
		return scheduling.Unavailable("falha ao obter identidade no estúdio")
	}

	u := c.baseURL.JoinPath(path)
	if query != nil {
		u.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
	if err != nil {
		return fmt.Errorf("montar requisição ao SaaS: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		c.observe(route, 0, time.Since(start))
		return scheduling.Unavailable("sistema de agenda inacessível")
	}
	defer resp.Body.Close()
	c.observe(route, resp.StatusCode, time.Since(start))

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return scheduling.Unavailable("resposta do sistema de agenda interrompida")
	}
	if resp.StatusCode >= http.StatusBadRequest {
		var p problem
		if json.Unmarshal(body, &p) != nil || p.Type == "" {
			return toDomainError(resp.StatusCode, nil)
		}
		return toDomainError(resp.StatusCode, &p)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return scheduling.Unavailable("resposta do sistema de agenda fora do formato")
	}
	return nil
}
