// Comando saas-mcp-server: servidor MCP (Streamable HTTP) com as ferramentas de agendamento
// sobre a API do SaaS de estúdios.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/adapters/saas"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/identity"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/mcpserver"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/observability"
	"github.com/JohnnyMatteus/whatsapp-booking-agent/services/saas-mcp-server/internal/scheduling"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type config struct {
	addr         string
	saasBaseURL  string
	authToken    string
	devTokens    map[string]string
	tokenURL     string
	clients      map[string]identity.ClientCredentials
	otlpEndpoint string
}

func loadConfig() (config, error) {
	c := config{
		addr:         envOr("HTTP_ADDR", ":8090"),
		saasBaseURL:  os.Getenv("SAAS_BASE_URL"),
		authToken:    os.Getenv("MCP_AUTH_TOKEN"),
		otlpEndpoint: os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
	}
	if c.saasBaseURL == "" || len(c.authToken) < 16 {
		return c, errors.New("SAAS_BASE_URL e MCP_AUTH_TOKEN (>= 16 caracteres) são obrigatórios")
	}
	if err := json.Unmarshal([]byte(envOr("SAAS_DEV_TOKENS", "{}")), &c.devTokens); err != nil {
		return c, fmt.Errorf("SAAS_DEV_TOKENS deve ser um objeto JSON estúdio -> token: %w", err)
	}
	c.tokenURL = os.Getenv("SAAS_TOKEN_URL")
	if err := json.Unmarshal([]byte(envOr("SAAS_AGENT_CLIENTS", "{}")), &c.clients); err != nil {
		return c, fmt.Errorf("SAAS_AGENT_CLIENTS deve ser um objeto JSON estúdio -> {client_id, client_secret}: %w", err)
	}
	return c, nil
}

// tokenSource usa a conta de serviço por estúdio no Keycloak quando SAAS_TOKEN_URL está
// definida; sem ela, cai nos tokens de desenvolvimento (mock do SaaS).
func tokenSource(c config) (identity.TokenSource, error) {
	if c.tokenURL == "" {
		return identity.NewStaticTokenSource(c.devTokens), nil
	}
	return identity.NewClientCredentialsSource(c.tokenURL, c.clients)
}

func main() {
	// A imagem distroless não tem shell nem curl: o healthcheck do compose usa o próprio binário.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(envOr("HTTP_ADDR", ":8090")))
	}
	logger := observability.NewLogger(slog.LevelInfo)
	if err := run(logger); err != nil {
		logger.Error("fatal", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTracing, err := observability.SetupTracing(ctx, cfg.otlpEndpoint)
	if err != nil {
		return err
	}
	metrics := observability.NewMetrics()

	httpClient := &http.Client{Timeout: 5 * time.Second, Transport: otelhttp.NewTransport(http.DefaultTransport)}
	tokens, err := tokenSource(cfg)
	if err != nil {
		return err
	}
	agenda, err := saas.NewClient(cfg.saasBaseURL, httpClient, tokens, metrics.ObserveSaaS)
	if err != nil {
		return err
	}
	server := mcpserver.New(scheduling.NewService(agenda, time.Now), logger, metrics.ObserveTool)
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)

	mux := http.NewServeMux()
	mux.Handle("/mcp", otelhttp.NewHandler(requireBearer(cfg.authToken, mcpHandler), "mcp"))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"status":"ok"}`)) })
	mux.Handle("GET /metrics", promhttp.HandlerFor(metrics.Registry, promhttp.HandlerOpts{}))

	srv := &http.Server{Addr: cfg.addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", cfg.addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	return shutdownTracing(shutdownCtx)
}

// requireBearer protege o endpoint MCP com um segredo compartilhado com o booking-agent.
// O servidor fica numa rede interna; o token impede chamadas de outros contêineres.
func requireBearer(token string, next http.Handler) http.Handler {
	expected := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), expected) != 1 {
			http.Error(w, `{"error":"não autorizado"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthcheck(addr string) int {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1" + addr[strings.LastIndex(addr, ":"):] + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
