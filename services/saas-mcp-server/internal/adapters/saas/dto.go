// Package saas é o adaptador do SaaS de estúdios: cliente HTTP da API v1 e a
// Anti-Corruption Layer que traduz o modelo do SaaS para o contexto de Agendamento.
package saas

// Os tipos abaixo espelham os recursos JSON da API do SaaS (SessionResource,
// BookingResource, problem+json). Não saem deste pacote.

type sessionResource struct {
	ID         string `json:"id"`
	SeriesID   string `json:"series_id"`
	Title      string `json:"title"`
	Instructor struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"instructor"`
	StartsAt       string `json:"starts_at"`
	EndsAt         string `json:"ends_at"`
	Timezone       string `json:"timezone"`
	Capacity       int    `json:"capacity"`
	ConfirmedCount int    `json:"confirmed_count"`
	AvailableSpots int    `json:"available_spots"`
	WaitlistCount  int    `json:"waitlist_count"`
}

type bookingResource struct {
	ID          string  `json:"id"`
	SessionID   string  `json:"session_id"`
	Status      string  `json:"status"`
	QueuedAt    string  `json:"queued_at"`
	ConfirmedAt *string `json:"confirmed_at"`
	CanceledAt  *string `json:"canceled_at"`
}

type paginationMeta struct {
	CurrentPage int `json:"current_page"`
	LastPage    int `json:"last_page"`
}

type sessionPage struct {
	Data []sessionResource `json:"data"`
	Meta paginationMeta    `json:"meta"`
}

type bookingPage struct {
	Data []bookingResource `json:"data"`
	Meta paginationMeta    `json:"meta"`
}

type sessionEnvelope struct {
	Data sessionResource `json:"data"`
}

type bookingEnvelope struct {
	Data bookingResource `json:"data"`
}

type cancellationEnvelope struct {
	Data struct {
		Canceled bookingResource  `json:"canceled"`
		Promoted *bookingResource `json:"promoted"`
	} `json:"data"`
}

// problem é o corpo application/problem+json (RFC 9457) devolvido pelo SaaS.
type problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
}
