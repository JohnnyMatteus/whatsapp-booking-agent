package identity

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestClientCredentialsSourceBuscaUmTokenPorEstudioEReaproveita(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		user, pass, _ := r.BasicAuth()
		if user != "whatsapp-agent-lotus" || pass != "dev-only-secret" {
			http.Error(w, `{"error":"invalid_client"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"jwt-da-conta-de-servico","token_type":"Bearer","expires_in":300}`))
	}))
	t.Cleanup(srv.Close)

	src, err := NewClientCredentialsSource(srv.URL, map[string]ClientCredentials{
		"estudio-lotus": {ClientID: "whatsapp-agent-lotus", ClientSecret: "dev-only-secret"},
	})
	if err != nil {
		t.Fatal(err)
	}

	for range 3 {
		tok, err := src.Token(context.Background(), "estudio-lotus", "5511999990001")
		if err != nil || tok != "jwt-da-conta-de-servico" {
			t.Fatalf("token = %q, err = %v", tok, err)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("o token deveria ser reaproveitado, chamadas = %d", calls.Load())
	}
}

func TestClientCredentialsSourceEstudioSemClient(t *testing.T) {
	src, err := NewClientCredentialsSource("http://idp.example.com/token", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.Token(context.Background(), "estudio-x", "1"); !errors.Is(err, ErrNoIdentity) {
		t.Fatalf("err = %v, quer ErrNoIdentity", err)
	}
}
