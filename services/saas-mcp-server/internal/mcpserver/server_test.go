package mcpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/adapters/saas"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/identity"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Ponta a ponta dentro do processo: cliente MCP → ferramentas → serviço → ACL → SaaS falso.

func saasStub(t *testing.T) string {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join("..", "adapters", "saas", "testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/sessions" && r.URL.Query().Get("page") == "1":
			_, _ = w.Write(read("sessions_page1.json"))
		case r.URL.Path == "/api/v1/sessions":
			_, _ = w.Write(read("sessions_page2.json"))
		case r.URL.Path == "/api/v1/me/bookings":
			_, _ = w.Write(read("my_bookings.json"))
		case r.URL.Path == "/api/v1/sessions/01JNX000000000000000PILATES":
			_, _ = w.Write(read("session_full.json"))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"type":"not_found","title":"Não encontrado","status":404,"detail":"x"}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/api"
}

func connect(t *testing.T) *mcp.ClientSession {
	t.Helper()
	agenda, err := saas.NewClient(saasStub(t), http.DefaultClient, identity.NewStaticTokenSource(map[string]string{"estudio-lotus": "dev-only-token"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	now := func() time.Time { return time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC) }
	server := New(scheduling.NewService(agenda, now), slog.New(slog.NewTextHandler(io.Discard, nil)), nil)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	if _, err := server.Connect(context.Background(), serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "teste", Version: "0.0.0"}, nil).Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func call(t *testing.T, session *mcp.ClientSession, tool string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	args["estudio"], args["contato"] = "estudio-lotus", "5511900000001"
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestExpoeAsCincoFerramentas(t *testing.T) {
	res, err := connect(t).ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	want := "cancelar,entrar_lista_espera,listar_horarios,reservar,vincular_contato"
	if strings.Join(names, ",") != want {
		t.Errorf("ferramentas = %v", names)
	}
}

func TestListarHorariosDevolveModeloDoAgendamento(t *testing.T) {
	res := call(t, connect(t), ToolListarHorarios, map[string]any{"de": "2026-03-03", "ate": "2026-03-04"})
	if res.IsError {
		t.Fatalf("erro inesperado: %v", res.Content)
	}

	raw, _ := json.Marshal(res.StructuredContent)
	var out struct {
		Aulas []map[string]any `json:"aulas"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Aulas) != 2 {
		t.Fatalf("aulas = %s", raw)
	}
	hatha := out.Aulas[0]
	if hatha["titulo"] != "Hatha Yoga" || hatha["minha_reserva"].(map[string]any)["situacao"] != "confirmada" {
		t.Errorf("hatha = %v", hatha)
	}
	for _, saasField := range []string{"capacity", "confirmed_count", "starts_at", "status", "series_id"} {
		if strings.Contains(string(raw), `"`+saasField+`"`) {
			t.Errorf("campo do SaaS %q vazou para a ferramenta", saasField)
		}
	}
}

func TestErroDeDominioVoltaComoResultadoDeErroComCodigo(t *testing.T) {
	res := call(t, connect(t), ToolReservar, map[string]any{"aula_id": "01JNX000000000000000PILATES"})

	if !res.IsError {
		t.Fatal("esperava isError")
	}
	text := res.Content[0].(*mcp.TextContent).Text
	var e scheduling.Error
	if err := json.Unmarshal([]byte(text), &e); err != nil {
		t.Fatalf("conteúdo não é JSON de erro: %s", text)
	}
	if e.Code != scheduling.CodeAulaLotada || e.Retryable {
		t.Errorf("erro = %+v", e)
	}
}

func TestEntradaSemCampoObrigatorioERecusadaPeloSchema(t *testing.T) {
	session := connect(t)
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: ToolCancelar, Arguments: map[string]any{"estudio": "estudio-lotus"}})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Error("esperava erro de validação de entrada")
	}
}
