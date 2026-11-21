// Package observability concentra logs (slog JSON), métricas (Prometheus) e traces
// (OpenTelemetry) do servidor MCP.
package observability

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// NewLogger cria o logger JSON em stdout.
func NewLogger(level slog.Level) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})).With("service", "saas-mcp-server")
}

// Metrics agrupa os coletores do serviço.
type Metrics struct {
	Registry    *prometheus.Registry
	toolCalls   *prometheus.CounterVec
	toolLatency *prometheus.HistogramVec
	saasLatency *prometheus.HistogramVec
}

// NewMetrics registra os coletores num registro próprio (sem estado global).
func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		toolCalls: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "wba_mcp_tool_calls_total",
			Help: "Chamadas de ferramenta MCP por ferramenta e resultado (ok ou código de erro de domínio).",
		}, []string{"tool", "result"}),
		toolLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "wba_mcp_tool_seconds",
			Help:    "Duração das chamadas de ferramenta MCP.",
			Buckets: prometheus.DefBuckets,
		}, []string{"tool"}),
		saasLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "wba_saas_request_seconds",
			Help:    "Duração das chamadas à API do SaaS por rota e status HTTP (0 = falha de rede).",
			Buckets: prometheus.DefBuckets,
		}, []string{"route", "status"}),
	}
	reg.MustRegister(m.toolCalls, m.toolLatency, m.saasLatency,
		prometheus.NewGoCollector(), prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}))
	return m
}

// ObserveTool registra uma chamada de ferramenta.
func (m *Metrics) ObserveTool(tool, result string, elapsed time.Duration) {
	m.toolCalls.WithLabelValues(tool, result).Inc()
	m.toolLatency.WithLabelValues(tool).Observe(elapsed.Seconds())
}

// ObserveSaaS registra uma chamada ao SaaS.
func (m *Metrics) ObserveSaaS(route string, status int, elapsed time.Duration) {
	m.saasLatency.WithLabelValues(route, strconv.Itoa(status)).Observe(elapsed.Seconds())
}

// SetupTracing configura o provedor global; sem endpoint, os spans não são exportados.
func SetupTracing(ctx context.Context, endpoint string) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	res := resource.NewSchemaless(semconv.ServiceName("saas-mcp-server"), semconv.ServiceVersion("0.1.0"))
	opts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}
	if endpoint != "" {
		exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"))
		if err != nil {
			return nil, err
		}
		opts = append(opts, sdktrace.WithBatcher(exporter))
	}
	provider := sdktrace.NewTracerProvider(opts...)
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}
