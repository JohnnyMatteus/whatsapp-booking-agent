package saas

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/identity"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
)

// Testes de contrato da ACL do SaaS: respostas no formato real da API v1 (testdata/)
// precisam virar exatamente estes valores do contexto de Agendamento.

var member = scheduling.Member{Studio: "estudio-lotus", Contact: "5511900000001"}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type route struct {
	status int
	body   []byte
}

func newClient(t *testing.T, routes map[string]route) (*Client, *[]*http.Request) {
	t.Helper()
	var seen []*http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r)
		key := r.Method + " " + r.URL.Path
		if page := r.URL.Query().Get("page"); page != "" {
			key += "?page=" + page
		}
		rt, ok := routes[key]
		if !ok {
			t.Errorf("rota inesperada: %s", key)
			w.WriteHeader(http.StatusTeapot)
			return
		}
		if rt.status >= 400 {
			w.Header().Set("Content-Type", "application/problem+json")
		}
		w.WriteHeader(rt.status)
		_, _ = w.Write(rt.body)
	}))
	t.Cleanup(srv.Close)
	tokens := identity.NewStaticTokenSource(map[string]string{"estudio-lotus": "dev-only-token"})
	c, err := NewClient(srv.URL+"/api", srv.Client(), tokens, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c, &seen
}

func problemBody(status int, typ string) []byte {
	return []byte(fmt.Sprintf(`{"type":%q,"title":"Conflito","status":%d,"detail":"texto livre do SaaS"}`, typ, status))
}

func TestListSessionsPercorrePaginasETraduzAulas(t *testing.T) {
	c, seen := newClient(t, map[string]route{
		"GET /api/v1/sessions?page=1": {200, fixture(t, "sessions_page1.json")},
		"GET /api/v1/sessions?page=2": {200, fixture(t, "sessions_page2.json")},
	})

	aulas, err := c.ListSessions(context.Background(), member, "2026-03-03", "2026-03-04")
	if err != nil {
		t.Fatal(err)
	}

	if len(aulas) != 2 {
		t.Fatalf("esperava 2 aulas, veio %d", len(aulas))
	}
	hatha, pilates := aulas[0], aulas[1]
	if hatha.ID != "01JNX0000000000000000HATHA" || hatha.Titulo != "Hatha Yoga" || hatha.Instrutor != "Instrutora Exemplo" ||
		hatha.VagasTotais != 12 || hatha.Confirmados != 7 || hatha.Fuso != "America/Sao_Paulo" || hatha.Inicio.Format("15:04Z07:00") != "21:00Z" {
		t.Errorf("aula traduzida errada: %+v", hatha)
	}
	if !pilates.Lotada() || pilates.Fila != 3 {
		t.Errorf("pilates deveria estar lotada com fila 3: %+v", pilates)
	}
	req := (*seen)[0]
	if got := req.Header.Get("Authorization"); got != "Bearer dev-only-token" {
		t.Errorf("Authorization = %q", got)
	}
	if q := req.URL.Query(); q.Get("from") != "2026-03-03" || q.Get("to") != "2026-03-04" || q.Get("per_page") != "100" {
		t.Errorf("query = %v", q)
	}
}

func TestMyBookingsTraduzStatus(t *testing.T) {
	c, _ := newClient(t, map[string]route{"GET /api/v1/me/bookings": {200, fixture(t, "my_bookings.json")}})

	reservas, err := c.MyBookings(context.Background(), member)
	if err != nil {
		t.Fatal(err)
	}

	want := []scheduling.Reserva{
		{ID: "01JNY00000000000000BOOKING1", AulaID: "01JNX0000000000000000HATHA", Situacao: scheduling.SituacaoConfirmada},
		{ID: "01JNY00000000000000BOOKING2", AulaID: "01JNX000000000000000PILATES", Situacao: scheduling.SituacaoCancelada},
	}
	if fmt.Sprint(reservas) != fmt.Sprint(want) {
		t.Errorf("reservas = %+v", reservas)
	}
}

func TestBookEmAulaLotadaVoltaEmEspera(t *testing.T) {
	c, _ := newClient(t, map[string]route{
		"POST /api/v1/sessions/01JNX000000000000000PILATES/bookings": {201, fixture(t, "booking_waitlisted.json")},
	})

	reserva, err := c.Book(context.Background(), member, "01JNX000000000000000PILATES")
	if err != nil {
		t.Fatal(err)
	}
	if reserva.Situacao != scheduling.SituacaoEmEspera {
		t.Errorf("situação = %s", reserva.Situacao)
	}
}

func TestCancelInformaPromocaoDaFila(t *testing.T) {
	c, _ := newClient(t, map[string]route{
		"POST /api/v1/bookings/01JNY00000000000000BOOKING1/cancel": {200, fixture(t, "cancel_with_promotion.json")},
	})

	cancelamento, err := c.Cancel(context.Background(), member, "01JNY00000000000000BOOKING1")
	if err != nil {
		t.Fatal(err)
	}
	if cancelamento.Reserva.Situacao != scheduling.SituacaoCancelada || !cancelamento.FilaPromovida {
		t.Errorf("cancelamento = %+v", cancelamento)
	}
}

func TestErrosDoSaaSViramErrosDeDominio(t *testing.T) {
	cases := []struct {
		status    int
		saasType  string
		want      scheduling.Code
		retryable bool
	}{
		{409, "already_booked", scheduling.CodeReservaDuplicada, false},
		{409, "overlapping_booking", scheduling.CodeConflitoHorario, false},
		{422, "session_already_started", scheduling.CodeAulaJaComecou, false},
		{422, "cancellation_window_closed", scheduling.CodeForaDaJanela, false},
		{409, "booking_already_canceled", scheduling.CodeReservaCancelada, false},
		{404, "not_found", scheduling.CodeNaoEncontrado, false},
		{401, "unauthenticated", scheduling.CodeAcessoNegado, false},
		{403, "forbidden", scheduling.CodeAcessoNegado, false},
		{403, "tenant_not_recognized", scheduling.CodeAcessoNegado, false},
		{422, "validation_failed", scheduling.CodeEntradaInvalida, false},
		{503, "identity_provider_unavailable", scheduling.CodeSaasIndisponivel, true},
		{500, "http_error", scheduling.CodeSaasIndisponivel, true},
		{429, "http_error", scheduling.CodeSaasIndisponivel, true},
		{409, "tipo_novo_que_o_saas_inventou", scheduling.CodeErroInesperado, false},
	}
	for _, tc := range cases {
		t.Run(tc.saasType, func(t *testing.T) {
			c, _ := newClient(t, map[string]route{
				"POST /api/v1/sessions/s1/bookings": {tc.status, problemBody(tc.status, tc.saasType)},
			})

			_, err := c.Book(context.Background(), member, "s1")

			domainErr, ok := scheduling.AsError(err)
			if !ok {
				t.Fatalf("esperava erro de domínio, veio %v", err)
			}
			if domainErr.Code != tc.want || domainErr.Retryable != tc.retryable {
				t.Errorf("erro = %+v, esperava %s (retentável=%v)", domainErr, tc.want, tc.retryable)
			}
			if domainErr.Message == "texto livre do SaaS" {
				t.Error("o detail do SaaS não deve vazar para o domínio")
			}
		})
	}
}

func TestRespostaForaDoFormatoOuRedeViramIndisponibilidade(t *testing.T) {
	c, _ := newClient(t, map[string]route{
		"GET /api/v1/sessions/s1":        {200, []byte(`{"data":{"id":"s1","starts_at":"ontem"}}`)},
		"GET /api/v1/me/bookings":        {200, []byte(`{"data":[{"id":"b1","session_id":"s1","status":"pending_payment"}]}`)},
		"POST /api/v1/bookings/b/cancel": {502, []byte(`<html>bad gateway</html>`)},
	})

	_, errSession := c.GetSession(context.Background(), member, "s1")
	_, errBookings := c.MyBookings(context.Background(), member)
	_, errCancel := c.Cancel(context.Background(), member, "b")

	for name, err := range map[string]error{"aula": errSession, "status novo": errBookings, "502 sem problem": errCancel} {
		if e, ok := scheduling.AsError(err); !ok || e.Code != scheduling.CodeSaasIndisponivel || !e.Retryable {
			t.Errorf("%s: esperava saas_indisponivel retentável, veio %v", name, err)
		}
	}

	offline, err := NewClient("http://127.0.0.1:1/api", &http.Client{}, identity.NewStaticTokenSource(map[string]string{"estudio-lotus": "t"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := offline.GetSession(context.Background(), member, "s1"); !isCode(err, scheduling.CodeSaasIndisponivel) {
		t.Errorf("rede: %v", err)
	}
}

func TestContatoSemIdentidadeNoEstudio(t *testing.T) {
	c, seen := newClient(t, map[string]route{})

	_, err := c.GetSession(context.Background(), scheduling.Member{Studio: "outro-estudio", Contact: "x"}, "s1")

	if !isCode(err, scheduling.CodeAcessoNegado) {
		t.Errorf("esperava acesso_negado, veio %v", err)
	}
	if len(*seen) != 0 {
		t.Error("não deveria chamar o SaaS sem token")
	}
}

func isCode(err error, code scheduling.Code) bool {
	var e *scheduling.Error
	return errors.As(err, &e) && e.Code == code
}
