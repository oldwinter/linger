package websearch

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/secretbox"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

type memoryStore struct {
	mu      sync.Mutex
	rows    map[string]store.ListWebSearchKeysRow
	chosen  pgtype.Text
	setting bool
}

func newMemoryStore() *memoryStore {
	return &memoryStore{rows: map[string]store.ListWebSearchKeysRow{}}
}

func (m *memoryStore) ListWebSearchKeys(context.Context) ([]store.ListWebSearchKeysRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rows := []store.ListWebSearchKeysRow{}
	for _, row := range m.rows {
		rows = append(rows, row)
	}
	return rows, nil
}

func (m *memoryStore) UpsertWebSearchKey(_ context.Context, arg store.UpsertWebSearchKeyParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rows[arg.Backend] = store.ListWebSearchKeysRow{Backend: arg.Backend, ApiKeyCiphertext: arg.ApiKeyCiphertext, State: arg.State}
	return nil
}

func (m *memoryStore) DeleteWebSearchKey(_ context.Context, backend string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rows, backend)
	return nil
}

func (m *memoryStore) MarkWebSearchKeyRejected(_ context.Context, arg store.MarkWebSearchKeyRejectedParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if row, ok := m.rows[arg.Backend]; ok && bytes.Equal(row.ApiKeyCiphertext, arg.ApiKeyCiphertext) {
		row.State = "rejected"
		m.rows[arg.Backend] = row
	}
	return nil
}

func (m *memoryStore) RecordWebSearchKeyAnswer(_ context.Context, arg store.RecordWebSearchKeyAnswerParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[arg.Backend]
	if !ok || !bytes.Equal(row.ApiKeyCiphertext, arg.ApiKeyCiphertext) {
		return nil
	}
	row.State = "verified"
	if arg.HasQuota {
		row.QuotaRemaining, row.QuotaLimit, row.QuotaResetsAt = arg.QuotaRemaining, arg.QuotaLimit, arg.QuotaResetsAt
		row.QuotaObservedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}
	m.rows[arg.Backend] = row
	return nil
}

func (m *memoryStore) GetWebSearchDefaultBackend(context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.setting {
		return "", pgx.ErrNoRows
	}
	return m.chosen.String, nil
}

func (m *memoryStore) SetWebSearchDefaultBackend(_ context.Context, value pgtype.Text) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chosen, m.setting = value, true
	return nil
}

func (m *memoryStore) ClearWebSearchDefaultBackend(_ context.Context, backend string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.chosen.String == backend {
		m.chosen = pgtype.Text{}
	}
	return nil
}

func testBox(t *testing.T) *secretbox.Box {
	t.Helper()
	box, err := secretbox.New(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	return box
}

// seen is one request a fake provider received.
type seen struct {
	method, path, query, auth, apiKey, token string
	body                                     map[string]any
	form                                     url.Values
}

// fakeProviders serves every provider from one server; handle answers each
// request and records it.
type fakeProviders struct {
	mu       sync.Mutex
	requests []seen
	server   *httptest.Server
}

func newFakeProviders(t *testing.T, handle func(w http.ResponseWriter, r seen)) *fakeProviders {
	t.Helper()
	fake := &fakeProviders{}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		request := seen{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, auth: r.Header.Get("Authorization"),
			apiKey: r.Header.Get("X-API-Key"), token: r.Header.Get("X-Subscription-Token")}
		_ = json.Unmarshal(raw, &request.body)
		if r.Header.Get("Content-Type") == "application/x-www-form-urlencoded" {
			request.form, _ = url.ParseQuery(string(raw))
		}
		fake.mu.Lock()
		fake.requests = append(fake.requests, request)
		fake.mu.Unlock()
		handle(w, request)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeProviders) endpoints() Endpoints {
	return Endpoints{Tavily: f.server.URL + "/tavily", Brave: f.server.URL + "/brave", Firecrawl: f.server.URL + "/firecrawl",
		YouAPI: f.server.URL + "/youapi", YouIndex: f.server.URL + "/youindex", YouMCP: f.server.URL + "/mcp/free",
		DuckDuckGo: f.server.URL + "/ddg", Exa: f.server.URL + "/exa", Client: f.server.Client()}
}

func (f *fakeProviders) seen() []seen {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]seen(nil), f.requests...)
}

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func newTestService(t *testing.T, fake *fakeProviders) (*Service, *memoryStore) {
	t.Helper()
	keys := newMemoryStore()
	return New(keys, testBox(t), fake.endpoints(), nil), keys
}

func saveRaw(t *testing.T, s *Service, keys *memoryStore, b Backend, key, state string) {
	t.Helper()
	sealed, err := s.box.Seal([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	_ = keys.UpsertWebSearchKey(t.Context(), store.UpsertWebSearchKeyParams{Backend: string(b), ApiKeyCiphertext: sealed, State: state})
}

func search(query string) Request {
	request, err := Normalize(Request{Command: CommandSearch, Query: query})
	if err != nil {
		panic(err)
	}
	return request
}

func TestRunSendsEachProviderItsRequestAndNormalizesResults(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/tavily/search":
			writeJSON(w, 200, `{"results":[{"title":"T","url":"https://t.example/a","content":"tavily text","published_date":"2026-11-01"},{"title":"bad","url":"javascript:alert(1)","content":"x"}]}`)
		case "/brave/res/v1/web/search":
			w.Header().Set("X-RateLimit-Limit", "1, 2000")
			w.Header().Set("X-RateLimit-Remaining", "0, 1500")
			w.Header().Set("X-RateLimit-Reset", "1, 86400")
			writeJSON(w, 200, `{"web":{"results":[{"title":"B &amp; co","url":"https://b.example","description":"a <strong>bold</strong> hit","age":"2 days ago"}]}}`)
		case "/firecrawl/v2/search":
			writeJSON(w, 200, `{"success":true,"data":{"web":[{"title":"F","url":"https://f.example","description":"firecrawl"}]}}`)
		case "/youindex/v1/search":
			writeJSON(w, 200, `{"results":{"web":[{"title":"Y","url":"https://y.example","snippets":["you snippet"],"page_age":"2026-10-01T00:00:00"}]}}`)
		default:
			t.Errorf("unexpected %s %s", r.method, r.path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	s, keys := newTestService(t, fake)
	for _, b := range []Backend{Tavily, Brave, Firecrawl, You} {
		saveRaw(t, s, keys, b, string(b)+"-secret", "verified")
	}
	cases := []struct {
		backend Backend
		request Request
		want    Result
	}{
		{Tavily, Request{Command: CommandSearch, Query: "q one", Limit: 3, Recency: "week", Sites: []string{"Docs.Example.com"}},
			Result{Title: "T", URL: "https://t.example/a", Snippet: "tavily text", PublishedAt: "2026-11-01"}},
		{Brave, Request{Command: CommandSearch, Query: "q two", Recency: "day", Sites: []string{"b.example"}},
			Result{Title: "B & co", URL: "https://b.example", Snippet: "a bold hit", PublishedAt: "2 days ago"}},
		{Firecrawl, Request{Command: CommandSearch, Query: "q three", Recency: "month"},
			Result{Title: "F", URL: "https://f.example", Snippet: "firecrawl"}},
		{You, Request{Command: CommandSearch, Query: "q four", Recency: "year"},
			Result{Title: "Y", URL: "https://y.example", Snippet: "you snippet", PublishedAt: "2026-10-01T00:00:00"}},
	}
	for _, tc := range cases {
		tc.request.Backend = tc.backend
		request, err := Normalize(tc.request)
		if err != nil {
			t.Fatalf("%s: Normalize = %v", tc.backend, err)
		}
		outcome, err := s.Run(t.Context(), request)
		if err != nil {
			t.Fatalf("%s: Run = %v", tc.backend, err)
		}
		if outcome.Backend != tc.backend || len(outcome.Results) != 1 || outcome.Results[0] != tc.want {
			t.Fatalf("%s: outcome = %+v", tc.backend, outcome)
		}
	}
	requests := fake.seen()
	tavily := requests[0]
	if tavily.auth != "Bearer tavily-secret" || tavily.body["max_results"] != float64(3) || tavily.body["time_range"] != "week" ||
		tavily.body["include_domains"].([]any)[0] != "docs.example.com" {
		t.Fatalf("tavily request = %+v", tavily)
	}
	brave := requests[1]
	if brave.token != "brave-secret" || !strings.Contains(brave.query, "freshness=pd") || !strings.Contains(brave.query, "q=q+two+site%3Ab.example") ||
		!strings.Contains(brave.query, "count=10") {
		t.Fatalf("brave request = %+v", brave)
	}
	if firecrawl := requests[2]; firecrawl.auth != "Bearer firecrawl-secret" || firecrawl.body["tbs"] != "qdr:m" {
		t.Fatalf("firecrawl request = %+v", firecrawl)
	}
	if you := requests[3]; you.apiKey != "you-secret" || you.body["freshness"] != "year" || you.body["count"] != float64(10) {
		t.Fatalf("you request = %+v", you)
	}
	// Brave's monthly window is kept from its headers.
	row := keys.rows[string(Brave)]
	if !row.QuotaRemaining.Valid || row.QuotaRemaining.Float64 != 1500 || row.QuotaLimit.Float64 != 2000 || !row.QuotaResetsAt.Valid {
		t.Fatalf("brave quota row = %+v", row)
	}
}

func TestRunClassifiesProviderRefusals(t *testing.T) {
	type reply struct {
		status int
		body   string
		header map[string]string
	}
	cases := []struct {
		name    string
		backend Backend
		reply   reply
		code    Code
		retry   time.Duration
	}{
		{"tavily 401", Tavily, reply{401, `{}`, nil}, CodeKeyRejected, 0},
		{"tavily 432", Tavily, reply{432, `{}`, nil}, CodeQuotaExhausted, 0},
		{"firecrawl 402", Firecrawl, reply{402, `{}`, nil}, CodeQuotaExhausted, 0},
		{"you 429", You, reply{429, `{}`, map[string]string{"Retry-After": "7"}}, CodeRateLimited, 7 * time.Second},
		{"brave token", Brave, reply{422, `{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID"}}`, nil}, CodeKeyRejected, 0},
		{"brave quota", Brave, reply{429, `{"error":{"code":"QUOTA_LIMITED"}}`, nil}, CodeQuotaExhausted, 0},
		{"brave rate", Brave, reply{429, `{"error":{"code":"RATE_LIMITED"}}`, map[string]string{"X-RateLimit-Reset": "1, 999"}}, CodeRateLimited, time.Second},
		{"tavily 500", Tavily, reply{500, `{}`, nil}, CodeProviderUnavailable, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProviders(t, func(w http.ResponseWriter, _ seen) {
				for name, value := range tc.reply.header {
					w.Header().Set(name, value)
				}
				writeJSON(w, tc.reply.status, tc.reply.body)
			})
			s, keys := newTestService(t, fake)
			saveRaw(t, s, keys, tc.backend, "provider-secret", "verified")
			saveRaw(t, s, keys, Firecrawl, "other-secret", "verified")
			request := search("private query")
			request.Backend = tc.backend
			_, err := s.Run(t.Context(), request)
			var failure *Failure
			if !errors.As(err, &failure) || failure.Code != tc.code || failure.Backend != tc.backend || failure.RetryAfter != tc.retry {
				t.Fatalf("Run = %#v", err)
			}
			if strings.Contains(err.Error(), "provider-secret") || strings.Contains(err.Error(), "private") {
				t.Fatalf("error leaks the request: %v", err)
			}
			rejected := keys.rows[string(tc.backend)].State == "rejected"
			if rejected != (tc.code == CodeKeyRejected) {
				t.Fatalf("state = %q", keys.rows[string(tc.backend)].State)
			}
			if tc.code == CodeQuotaExhausted || tc.code == CodeRateLimited {
				wantReady := []Backend{Firecrawl, You, DuckDuckGo}
				switch tc.backend {
				case Firecrawl:
					wantReady = []Backend{You, DuckDuckGo}
				case You:
					wantReady = []Backend{Firecrawl, DuckDuckGo}
				}
				if !slices.Equal(failure.Ready, wantReady) {
					t.Fatalf("ready = %v, want %v", failure.Ready, wantReady)
				}
			}
		})
	}
}

func TestRunRefusesAFilterTheBackendCannotHonorBeforeAnyCall(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, _ seen) { writeJSON(w, 200, `{}`) })
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Firecrawl, "provider-secret", "verified")
	saveRaw(t, s, keys, Brave, "provider-secret", "verified")
	for _, request := range []Request{
		{Command: CommandSearch, Backend: Firecrawl, Query: "q", Sites: []string{"a.example"}},
		{Command: CommandSearch, Backend: Brave, Query: "q", Sites: []string{"a.example", "b.example"}},
	} {
		normalized, err := Normalize(request)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Run(t.Context(), normalized)
		var failure *Failure
		if !errors.As(err, &failure) || failure.Code != CodeUnsupported {
			t.Fatalf("Run = %v", err)
		}
	}
	if requests := fake.seen(); len(requests) != 0 {
		t.Fatalf("providers were called: %+v", requests)
	}
	if _, err := Normalize(Request{Command: CommandOpen, Backend: Brave, URL: "https://a.example"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("open with brave = %v", err)
	}
	if _, err := Normalize(Request{Command: CommandOpen, URL: "file:///etc/passwd"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("open a file URL = %v", err)
	}
}

// keylessMCP answers You.com's MCP handshake and then tools/call.
func keylessMCP(t *testing.T, call func(w http.ResponseWriter, r seen)) func(w http.ResponseWriter, r seen) {
	return func(w http.ResponseWriter, r seen) {
		if r.path != "/mcp/free" {
			t.Errorf("unexpected %s %s", r.method, r.path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.body["method"] {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "session-1")
			writeJSON(w, 200, `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}`)
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		default:
			call(w, r)
		}
	}
}

func TestYouWithoutAKeyUsesTheFreeMCP(t *testing.T) {
	fake := newFakeProviders(t, keylessMCP(t, func(w http.ResponseWriter, r seen) {
		params := r.body["params"].(map[string]any)
		if params["name"] != "you-search" || params["arguments"].(map[string]any)["query"] != "q" {
			t.Errorf("tools/call = %+v", params)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{}}\n\n" +
			"data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"structuredContent\":{\"results\":{\"web\":[{\"title\":\"K\",\"url\":\"https://k.example\",\"description\":\"keyless\"}]}}}}\n\n"))
	}))
	s, _ := newTestService(t, fake)
	request := search("q")
	request.Backend = You
	outcome, err := s.Run(t.Context(), request)
	if err != nil || outcome.Backend != You || len(outcome.Results) != 1 || outcome.Results[0].Snippet != "keyless" {
		t.Fatalf("Run = %+v, %v", outcome, err)
	}
	requests := fake.seen()
	if len(requests) != 3 || requests[2].apiKey != "" {
		t.Fatalf("requests = %+v", requests)
	}
}

func TestKeylessFreeLimitAsksForAKey(t *testing.T) {
	fake := newFakeProviders(t, keylessMCP(t, func(w http.ResponseWriter, _ seen) { writeJSON(w, 429, `{}`) }))
	s, _ := newTestService(t, fake)
	request := search("q")
	request.Backend = You
	_, err := s.Run(t.Context(), request)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodeFreeLimit || failure.Backend != You || failure.Suggested || !failure.KeyFailure() {
		t.Fatalf("Run = %#v", err)
	}
}

func TestRunWithoutAKeyNamesTheBackend(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, _ seen) { t.Error("no call expected") })
	s, keys := newTestService(t, fake)
	request := search("q")
	request.Backend = Brave
	_, err := s.Run(t.Context(), request)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodeKeyRequired || failure.Backend != Brave || failure.Suggested {
		t.Fatalf("Run = %#v", err)
	}
	saveRaw(t, s, keys, Tavily, "provider-secret", "rejected")
	request.Backend = Tavily
	if _, err = s.Run(t.Context(), request); !errors.As(err, &failure) || failure.Code != CodeKeyRejected {
		t.Fatalf("Run with a rejected key = %#v", err)
	}
}

func TestDefaultSearchUsesTheChosenDefaultWithoutFallingBack(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/firecrawl/v2/search":
			writeJSON(w, 200, `{"data":{"web":[]}}`)
		case "/brave/res/v1/web/search":
			writeJSON(w, 200, `{"web":{"results":[]}}`)
		default:
			t.Errorf("unexpected %s", r.path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Firecrawl, "provider-secret", "verified")
	saveRaw(t, s, keys, Brave, "provider-secret", "unverified")
	saveRaw(t, s, keys, Tavily, "provider-secret", "rejected")
	outcome, err := s.Run(t.Context(), search("q"))
	if err != nil || outcome.Backend != Brave {
		t.Fatalf("order Run = %+v, %v", outcome, err)
	}
	if _, err := s.SetDefault(t.Context(), Tavily); !errors.Is(err, ErrNotReady) {
		t.Fatalf("SetDefault(rejected) = %v", err)
	}
	chosen, err := s.SetDefault(t.Context(), Firecrawl)
	if err != nil || chosen.DefaultSearch != Firecrawl || chosen.ChosenDefault != Firecrawl {
		t.Fatalf("SetDefault = %+v, %v", chosen, err)
	}
	if outcome, err = s.Run(t.Context(), search("q")); err != nil || outcome.Backend != Firecrawl {
		t.Fatalf("default Run = %+v, %v", outcome, err)
	}
	saveRaw(t, s, keys, Firecrawl, "provider-secret", "rejected")
	var failure *Failure
	if _, err = s.Run(t.Context(), search("q")); !errors.As(err, &failure) || failure.Code != CodeKeyRejected ||
		failure.Backend != Firecrawl || failure.Suggested {
		t.Fatalf("Run with a rejected chosen default = %#v", err)
	}
	if list, err := s.List(t.Context(), false); err != nil || list.DefaultSearch != Firecrawl || list.ChosenDefault != Firecrawl {
		t.Fatalf("List with a rejected chosen default = %+v, %v", list, err)
	}
	if err := s.RemoveKey(t.Context(), Firecrawl); err != nil {
		t.Fatal(err)
	}
	cleared, err := s.ClearDefault(t.Context())
	if err != nil || cleared.DefaultSearch != Brave || cleared.ChosenDefault != "" {
		t.Fatalf("ClearDefault = %+v, %v", cleared, err)
	}
}

func TestSaveKeyUsesTheOfficialCheck(t *testing.T) {
	status := 200
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		if r.path != "/tavily/usage" || r.method != http.MethodGet || !strings.HasPrefix(r.auth, "Bearer tvly-") {
			t.Errorf("check = %+v", r)
		}
		writeJSON(w, status, `{"key":{"usage":10,"limit":null},"account":{"current_plan":"Researcher","plan_usage":100,"plan_limit":1000}}`)
	})
	s, keys := newTestService(t, fake)
	view, err := s.SaveKey(t.Context(), Tavily, " tvly-secret ")
	if err != nil || view.KeyState != "verified" || view.Status != "ready" || view.Quota.From != "provider" ||
		*view.Quota.Remaining != 900 || *view.Quota.Limit != 1000 || view.Quota.Plan != "Researcher" {
		t.Fatalf("SaveKey = %+v, %v", view, err)
	}
	if bytes.Contains(keys.rows[string(Tavily)].ApiKeyCiphertext, []byte("tvly-secret")) {
		t.Fatal("key stored in clear")
	}
	status = 401
	if _, err := s.SaveKey(t.Context(), Tavily, "tvly-other"); !errors.Is(err, ErrKeyRejected) {
		t.Fatalf("SaveKey(refused) = %v", err)
	}
	opened, _ := s.box.Open(keys.rows[string(Tavily)].ApiKeyCiphertext)
	if string(opened) != "tvly-secret" {
		t.Fatal("a refused key replaced the saved one")
	}
	brave, err := s.SaveKey(t.Context(), Brave, "brave-secret")
	if err != nil || brave.KeyState != "unverified" || brave.Status != "ready" || brave.Quota.Reason != "not_observed" {
		t.Fatalf("SaveKey(brave) = %+v, %v", brave, err)
	}
	if len(fake.seen()) != 2 {
		t.Fatal("a Brave key was checked")
	}
	for _, key := range []string{"", "has space", strings.Repeat("k", MaxKeyBytes+1)} {
		if _, err := s.SaveKey(t.Context(), Tavily, key); !errors.Is(err, ErrInvalid) {
			t.Fatalf("SaveKey(%q) = %v", key, err)
		}
	}
	if _, err := New(newMemoryStore(), nil, fake.endpoints(), nil).SaveKey(t.Context(), Tavily, "k"); !errors.Is(err, ErrStorageMissing) {
		t.Fatalf("SaveKey without a box = %v", err)
	}
}

func TestSaveReplayedRunsTheRequestWithTheCandidateKey(t *testing.T) {
	status, body := 200, `{"web":{"results":[{"title":"B","url":"https://b.example","description":"hit"}]}}`
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		if !strings.HasPrefix(r.token, "brave-candidate") {
			t.Errorf("token = %q", r.token)
		}
		writeJSON(w, status, body)
	})
	s, keys := newTestService(t, fake)
	request := search("private query")
	request.Backend = Tavily
	replay, err := s.SaveReplayed(t.Context(), Brave, "brave-candidate", request)
	if err != nil || replay.Failure != nil || len(replay.Outcome.Results) != 1 || replay.View.KeyState != "verified" {
		t.Fatalf("SaveReplayed = %+v, %v", replay, err)
	}
	status, body = 401, `{}`
	if _, err := s.SaveReplayed(t.Context(), Brave, "brave-candidate2", request); !errors.Is(err, ErrKeyRejected) {
		t.Fatalf("SaveReplayed(refused) = %v", err)
	}
	if opened, _ := s.box.Open(keys.rows[string(Brave)].ApiKeyCiphertext); string(opened) != "brave-candidate" {
		t.Fatal("a refused key was saved")
	}
	for _, tc := range []struct {
		status int
		code   Code
		state  string
	}{{429, CodeRateLimited, "verified"}, {503, CodeProviderUnavailable, "unverified"}} {
		status, body = tc.status, `{}`
		replay, err := s.SaveReplayed(t.Context(), Brave, "brave-candidate", request)
		if err != nil || replay.Failure == nil || replay.Failure.Code != tc.code || keys.rows[string(Brave)].State != tc.state {
			t.Fatalf("HTTP %d: SaveReplayed = %+v, %v, state %q", tc.status, replay, err, keys.rows[string(Brave)].State)
		}
	}
	// A filter the chosen backend cannot honor saves the key unverified
	// without a call.
	calls := len(fake.seen())
	request.Sites = []string{"a.example"}
	replay, err = s.SaveReplayed(t.Context(), Firecrawl, "fc-candidate", request)
	if err != nil || replay.Failure == nil || replay.Failure.Code != CodeUnsupported || keys.rows[string(Firecrawl)].State != "unverified" ||
		len(fake.seen()) != calls {
		t.Fatalf("SaveReplayed(unsupported) = %+v, %v", replay, err)
	}
}

func TestOpenReadsThePageThroughEachBackend(t *testing.T) {
	long := strings.Repeat("é", MaxMarkdown+5)
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/tavily/extract":
			writeJSON(w, 200, `{"results":[{"url":"https://t.example/final","raw_content":"`+long+`"}],"failed_results":[]}`)
		case "/firecrawl/v2/scrape":
			writeJSON(w, 200, `{"success":true,"data":{"markdown":"","metadata":{"statusCode":404}}}`)
		case "/youindex/v1/extract":
			if r.body["url"] != "https://y.example" {
				t.Errorf("extract body = %+v", r.body)
			}
			writeJSON(w, 200, `{"url":"https://y.example","title":"Y page","contents":{"full_page":{"markdown":"# Y"}}}`)
		}
	})
	s, keys := newTestService(t, fake)
	for _, b := range []Backend{Tavily, Firecrawl, You} {
		saveRaw(t, s, keys, b, "provider-secret", "verified")
	}
	open := func(b Backend, link string) (Outcome, error) {
		request, err := Normalize(Request{Command: CommandOpen, Backend: b, URL: link})
		if err != nil {
			t.Fatal(err)
		}
		return s.Run(t.Context(), request)
	}
	outcome, err := open(Tavily, "https://t.example")
	if err != nil || outcome.Page == nil || !outcome.Page.Truncated || len([]rune(outcome.Page.Markdown)) != MaxMarkdown ||
		outcome.Page.URL != "https://t.example/final" {
		t.Fatalf("tavily open = %v", err)
	}
	_, err = open(Firecrawl, "https://f.example")
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodePageUnreadable || failure.Backend != Firecrawl {
		t.Fatalf("firecrawl open = %#v", err)
	}
	outcome, err = open(You, "https://y.example")
	if err != nil || outcome.Page.Title != "Y page" || outcome.Page.Markdown != "# Y" || outcome.Page.Truncated {
		t.Fatalf("you open = %+v, %v", outcome.Page, err)
	}
}

func TestKeylessOpenReadsTheExtractOutput(t *testing.T) {
	fake := newFakeProviders(t, keylessMCP(t, func(w http.ResponseWriter, r seen) {
		if r.body["params"].(map[string]any)["name"] != "you-extract" {
			t.Errorf("tools/call = %+v", r.body)
		}
		writeJSON(w, 200, `{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"output":[{"url":"https://k.example","title":"K","markdown":"body"}]}}}`)
	}))
	s, _ := newTestService(t, fake)
	request, err := Normalize(Request{Command: CommandOpen, Backend: You, URL: "https://k.example"})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := s.Run(t.Context(), request)
	if err != nil || outcome.Page.Title != "K" || outcome.Page.Markdown != "body" {
		t.Fatalf("Run = %+v, %v", outcome, err)
	}
}

func TestListReportsTiersStatesAndLiveQuota(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/firecrawl/v2/team/credit-usage":
			writeJSON(w, 200, `{"success":true,"data":{"remainingCredits":420,"planCredits":500,"billingPeriodEnd":"2026-12-01T00:00:00Z"}}`)
		case "/youapi/v1/billing/account_balance":
			time.Sleep(quotaTimeout + time.Second)
			writeJSON(w, 200, `{}`)
		default:
			t.Errorf("unexpected %s", r.path)
		}
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Firecrawl, "provider-secret", "verified")
	saveRaw(t, s, keys, Tavily, "provider-secret", "rejected")
	saveRaw(t, s, keys, Brave, "provider-secret", "unverified")
	list, err := s.List(t.Context(), true)
	if err != nil || list.DefaultSearch != Brave || list.DefaultOpen != Direct || !list.CanSaveKeys || len(list.Backends) != 7 {
		t.Fatalf("List = %+v, %v", list, err)
	}
	byID := map[Backend]BackendView{}
	for _, view := range list.Backends {
		byID[view.ID] = view
	}
	if v := byID[Tavily]; v.Status != "key_rejected" || v.KeyState != "rejected" || v.Quota.Reason != "key_rejected" || v.Tier != TierKey {
		t.Fatalf("tavily = %+v", v)
	}
	if v := byID[Firecrawl]; v.Status != "ready" || v.Quota.From != "provider" || *v.Quota.Remaining != 420 || *v.Quota.Limit != 500 ||
		v.Quota.ResetsAt == nil || len(v.Filters) != 1 || v.MaxSites != 0 {
		t.Fatalf("firecrawl = %+v", v)
	}
	if v := byID[You]; v.Status != "ready" || v.Tier != TierFree || v.TierText == "" || v.Quota.From != "unavailable" || v.Quota.Reason != "not_reported" {
		t.Fatalf("you = %+v", v)
	}
	if v := byID[DuckDuckGo]; v.Status != "ready" || v.Tier != TierFree || v.TierText == "" || v.KeyState != "none" ||
		v.MaxLimit != 10 || v.MaxSites != 1 || len(v.Commands) != 1 || v.Commands[0] != CommandSearch {
		t.Fatalf("duckduckgo = %+v", v)
	}
	if v := byID[Direct]; v.Tier != TierNone || v.Status != "ready" || len(v.Commands) != 1 || v.Commands[0] != CommandOpen {
		t.Fatalf("direct = %+v", v)
	}
	saveRaw(t, s, keys, You, "provider-secret", "verified")
	start := time.Now()
	list, err = s.List(t.Context(), true)
	if err != nil || time.Since(start) > quotaTimeout+500*time.Millisecond {
		t.Fatalf("List took %s, %v", time.Since(start), err)
	}
	for _, view := range list.Backends {
		if view.ID == You && (view.Tier != TierKey || view.Quota.Reason != "provider_unavailable") {
			t.Fatalf("you with a slow usage endpoint = %+v", view)
		}
	}
}

func TestListWithoutQuotaCallsNoProvider(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		t.Errorf("unexpected %s", r.path)
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Firecrawl, "provider-secret", "verified")
	saveRaw(t, s, keys, You, "provider-secret", "verified")
	saveRaw(t, s, keys, Tavily, "provider-secret", "verified")
	list, err := s.List(t.Context(), false)
	if err != nil || len(list.Backends) != 7 || len(fake.seen()) != 0 {
		t.Fatalf("List = %+v, %v, calls %d", list, err, len(fake.seen()))
	}
	for _, view := range list.Backends {
		raw, err := json.Marshal(view)
		if err != nil || view.Name == "" || view.Status == "" || strings.Contains(string(raw), `"quota"`) {
			t.Fatalf("backend without quota = %s, %v", raw, err)
		}
	}
}

func TestBackendReadsItsStatusWithoutCallingAProvider(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		t.Errorf("unexpected %s", r.path)
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Tavily, "provider-secret", "verified")
	view, err := s.Backend(t.Context(), Tavily)
	if err != nil || view.ID != Tavily || view.Status != "ready" || len(fake.seen()) != 0 {
		t.Fatalf("Backend = %+v, %v, calls %d", view, err, len(fake.seen()))
	}
}
