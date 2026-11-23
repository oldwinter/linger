package voicekey

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// fakeSonioxRealtime stands in for Soniox's realtime stream. It checks what
// the probe sends, then answers with reply; an empty reply hangs up.
func fakeSonioxRealtime(t *testing.T, reply string) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer provider-secret" {
			t.Errorf("handshake auth=%q", r.Header.Get("Authorization"))
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		kind, start, err := conn.ReadMessage()
		var config map[string]any
		if err != nil || kind != websocket.TextMessage || json.Unmarshal(start, &config) != nil || config["model"] != sonioxRealtimeModel || config["api_key"] != nil {
			t.Errorf("start request %d %s: %v", kind, start, err)
		}
		if kind, end, err := conn.ReadMessage(); err != nil || kind != websocket.TextMessage || len(end) != 0 {
			t.Errorf("end of stream %d %q: %v", kind, end, err)
		}
		if reply != "" {
			_ = conn.WriteMessage(websocket.TextMessage, []byte(reply))
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func realtimeURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func TestHTTPCheckerAsksEachProviderWithTheKey(t *testing.T) {
	realtime := fakeSonioxRealtime(t, `{"tokens":[],"finished":true}`)
	for _, tc := range []struct {
		provider Provider
		path     string
	}{{Soniox, "/v1/files"}, {XAI, "/v1/api-key"}} {
		t.Run(string(tc.provider), func(t *testing.T) {
			for _, status := range []struct {
				code int
				want error
			}{
				{http.StatusOK, nil},
				{http.StatusBadRequest, ErrRejected},
				{http.StatusUnauthorized, ErrRejected},
				{http.StatusPaymentRequired, ErrNoBalance},
				{http.StatusForbidden, ErrRejected},
				{http.StatusTooManyRequests, ErrProviderUnavailable},
				{http.StatusInternalServerError, ErrProviderUnavailable},
				{http.StatusBadGateway, ErrProviderUnavailable},
			} {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodGet || r.URL.Path != tc.path || r.Header.Get("Authorization") != "Bearer provider-secret" {
						t.Errorf("request %s %s auth=%q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
					}
					w.WriteHeader(status.code)
				}))
				checker := &HTTPChecker{SonioxBaseURL: server.URL, SonioxRealtimeURL: realtimeURL(realtime), XAIBaseURL: server.URL, Client: server.Client()}
				if err := checker.Check(t.Context(), tc.provider, "provider-secret"); !errors.Is(err, status.want) || (status.want == nil && err != nil) {
					t.Fatalf("HTTP %d: Check = %v, want %v", status.code, err, status.want)
				}
				server.Close()
			}
		})
	}
}

// A Soniox key the REST API accepts can still be refused on the realtime
// stream: revoked there, out of balance, or without realtime permission.
func TestHTTPCheckerProbesTheSonioxRealtimeStream(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer files.Close()
	for _, tc := range []struct {
		name  string
		reply string
		want  error
	}{
		{"finished", `{"tokens":[],"final_audio_proc_ms":0,"total_audio_proc_ms":0,"finished":true}`, nil},
		{"no audio", `{"tokens":[],"error_code":400,"error_type":"invalid_request"}`, nil},
		{"rejected key", `{"tokens":[],"error_code":401,"error_type":"unauthenticated"}`, ErrRejected},
		{"no balance", `{"tokens":[],"error_code":402,"error_type":"organization_balance_exhausted"}`, ErrNoBalance},
		{"no realtime permission", `{"tokens":[],"error_code":403,"error_type":"permission_denied"}`, ErrNoRealtime},
		{"stream limit reached", `{"tokens":[],"error_code":429,"error_type":"limit_exceeded"}`, nil},
		{"unavailable", `{"tokens":[],"error_code":503,"error_type":"service_unavailable"}`, ErrProviderUnavailable},
		{"hung up", "", ErrProviderUnavailable},
		{"not json", "not json", ErrProviderUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			realtime := fakeSonioxRealtime(t, tc.reply)
			checker := &HTTPChecker{SonioxBaseURL: files.URL, SonioxRealtimeURL: realtimeURL(realtime), Client: files.Client()}
			err := checker.Check(t.Context(), Soniox, "provider-secret")
			if !errors.Is(err, tc.want) || (tc.want == nil && err != nil) {
				t.Fatalf("Check = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestHTTPCheckerReadsARefusedSonioxHandshake(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer files.Close()
	for status, want := range map[int]error{
		http.StatusUnauthorized:        ErrRejected,
		http.StatusPaymentRequired:     ErrNoBalance,
		http.StatusForbidden:           ErrNoRealtime,
		http.StatusBadRequest:          ErrProviderUnavailable,
		http.StatusInternalServerError: ErrProviderUnavailable,
	} {
		realtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
		checker := &HTTPChecker{SonioxBaseURL: files.URL, SonioxRealtimeURL: realtimeURL(realtime), Client: files.Client()}
		err := checker.Check(t.Context(), Soniox, "provider-secret")
		realtime.Close()
		if !errors.Is(err, want) {
			t.Fatalf("HTTP %d: Check = %v, want %v", status, err, want)
		}
	}
}

// A stream Soniox opens but never answers ends at the deadline instead of
// holding the save.
func TestHTTPCheckerStopsWaitingOnASilentSonioxStream(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer files.Close()
	release := make(chan struct{})
	realtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		<-release
	}))
	defer realtime.Close()
	defer close(release)
	checker := &HTTPChecker{SonioxBaseURL: files.URL, SonioxRealtimeURL: realtimeURL(realtime), Client: files.Client()}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	began := time.Now()
	if err := checker.Check(ctx, Soniox, "provider-secret"); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("Check = %v, want ErrProviderUnavailable", err)
	}
	if elapsed := time.Since(began); elapsed > 30*time.Second {
		t.Fatalf("Check waited %v", elapsed)
	}
}

func TestHTTPCheckerUnreachableProvider(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	server.Close()
	checker := &HTTPChecker{SonioxBaseURL: server.URL, SonioxRealtimeURL: realtimeURL(server), XAIBaseURL: server.URL, Client: http.DefaultClient}
	err := checker.Check(t.Context(), Soniox, "provider-secret")
	if !errors.Is(err, ErrProviderUnavailable) || err.Error() != ErrProviderUnavailable.Error() {
		t.Fatalf("Check = %v, want only ErrProviderUnavailable", err)
	}
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer files.Close()
	checker = &HTTPChecker{SonioxBaseURL: files.URL, SonioxRealtimeURL: realtimeURL(server), Client: files.Client()}
	if err := checker.Check(t.Context(), Soniox, "provider-secret"); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("realtime unreachable: Check = %v, want ErrProviderUnavailable", err)
	}
}

func TestNewHTTPCheckerUsesTheProviderAPIs(t *testing.T) {
	checker := NewHTTPChecker()
	if checker.SonioxBaseURL != "https://api.soniox.com" || checker.SonioxRealtimeURL != "wss://stt-rt.soniox.com/transcribe-websocket" || checker.XAIBaseURL != "https://api.x.ai" || checker.Client.Timeout == 0 {
		t.Fatalf("checker = %+v", checker)
	}
}

// xAI describes a blocked or disabled key with 200; only its flags are read.
func TestHTTPCheckerRejectsBlockedXAIKeys(t *testing.T) {
	for _, tc := range []struct {
		body string
		want error
	}{
		{`{"api_key_blocked":true,"name":"k"}`, ErrRejected},
		{`{"api_key_disabled":true}`, ErrRejected},
		{`{"team_blocked":true}`, ErrRejected},
		{`{"api_key_blocked":false,"api_key_disabled":false,"team_blocked":false}`, nil},
		{`{"name":"k"}`, nil},
		{`not json`, nil},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(tc.body))
		}))
		checker := &HTTPChecker{XAIBaseURL: server.URL, Client: server.Client()}
		err := checker.Check(t.Context(), XAI, "provider-secret")
		server.Close()
		if !errors.Is(err, tc.want) || (tc.want == nil && err != nil) {
			t.Fatalf("%s: Check = %v, want %v", tc.body, err, tc.want)
		}
	}
}
