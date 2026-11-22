package integration_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/app"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/config"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/websearch"
)

// fakeSearchProviders serves You.com's keyless MCP server (its free searches
// used up), Brave's search API and Tavily's usage endpoint.
func fakeSearchProviders(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/mcp/free":
			var message struct {
				Method string `json:"method"`
			}
			_ = json.Unmarshal(raw, &message)
			switch message.Method {
			case "initialize":
				_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}`))
			case "notifications/initialized":
				w.WriteHeader(http.StatusAccepted)
			default:
				w.WriteHeader(http.StatusTooManyRequests)
			}
		case "/brave/res/v1/web/search":
			if r.Header.Get("X-Subscription-Token") != "brave-good" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = w.Write([]byte(`{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID"}}`))
				return
			}
			w.Header().Set("X-RateLimit-Remaining", "0, 1999")
			_, _ = w.Write([]byte(`{"web":{"results":[{"title":"Rust","url":"https://rust.example/news","description":"release notes"}]}}`))
		case "/tavily/usage":
			if r.Header.Get("Authorization") != "Bearer tvly-good" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"key":{"usage":0},"account":{"current_plan":"Researcher","plan_usage":10,"plan_limit":1000}}`))
		default:
			t.Errorf("unexpected provider call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	registerIntegrationServerCleanup(t, server)
	return server
}

type agentSearchFailure struct {
	Error struct {
		Code    string `json:"code"`
		Details struct {
			Backend       string `json:"backend"`
			Origin        string `json:"origin"`
			Reason        string `json:"reason"`
			MessageID     string `json:"message_id"`
			InteractionID string `json:"interaction_id"`
		} `json:"details"`
	} `json:"error"`
}

// A search that needs a key posts one card, reused and kept current while it
// waits. A key added from the card is proven by replaying the Agent's search,
// whose results wake the Agent; a key the provider refuses is not saved. A key
// saved from Connectors answers the other waiting cards with the backend to
// use.
func TestWebSearchAsksForAKeyAndReplaysTheSearchWithIt(t *testing.T) {
	allowParallelIntegrationTest(t)
	providers := fakeSearchProviders(t)
	env, alice, issued, roomID := newAgentCLIIdentity(t, withConfig(func(cfg *config.Config) {
		cfg.ExternalApps.SecretEncryptionKey = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{5}, 32))
	}), withDeps(func(deps *app.Deps) {
		deps.WebSearch = websearch.Endpoints{
			Tavily: providers.URL + "/tavily", Brave: providers.URL + "/brave", YouMCP: providers.URL + "/mcp/free",
			DuckDuckGo: providers.URL + "/ddg", Client: providers.Client(),
		}
	}))
	search := func(body map[string]any) (int, []byte) {
		t.Helper()
		return postAgentInRoom(t, env, issued.AccessToken, roomID, "/api/agent/v1/web/search", body)
	}

	status, body := search(map[string]any{"query": "rust news", "backend": "you"})
	var failure agentSearchFailure
	decode(t, body, &failure)
	details := failure.Error.Details
	if status != http.StatusConflict || failure.Error.Code != "search_key_requested" || details.Backend != "you" ||
		details.Origin != "requested" || details.Reason != "free_limit" || details.InteractionID == "" {
		t.Fatalf("search after the free searches: %d %s", status, body)
	}
	cardID, cardMessage := details.InteractionID, details.MessageID

	status, body = search(map[string]any{"query": "rust releases", "backend": "brave"})
	decode(t, body, &failure)
	if status != http.StatusConflict || failure.Error.Details.InteractionID != cardID || failure.Error.Details.Origin != "requested" {
		t.Fatalf("second search: %d %s", status, body)
	}
	var view, request string
	if err := env.pool.QueryRow(t.Context(), `SELECT view::text,request::text FROM decisions WHERE id=$1`, cardID).Scan(&view, &request); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(view, `"backend": "brave"`) || !strings.Contains(view, `"reason": "missing"`) || !strings.Contains(request, "rust releases") {
		t.Fatalf("reused card view=%s request=%s", view, request)
	}

	code, _, listed := env.request(alice, http.MethodGet, "/v0/web-search/backends", nil, "")
	var list websearch.List
	decode(t, listed, &list)
	if code != http.StatusOK || list.DefaultSearch != websearch.DuckDuckGo || !list.CanSaveKeys || len(list.Backends) != 7 ||
		list.Backends[4].ID != websearch.You || list.Backends[4].Tier != websearch.TierFree {
		t.Fatalf("backends: %d %s", code, listed)
	}
	code, _, listed = env.request(alice, http.MethodGet, "/v0/web-search/backends?include_quota=false", nil, "")
	if code != http.StatusOK || strings.Contains(string(listed), `"quota"`) || !strings.Contains(string(listed), `"tier":"free"`) {
		t.Fatalf("backends without quota: %d %s", code, listed)
	}

	saveKey := func(backend, key, decisionID string) (int, []byte) {
		t.Helper()
		payload := map[string]any{"api_key": key}
		if decisionID != "" {
			payload["decision_id"] = decisionID
		}
		code, _, body := env.request(alice, http.MethodPut, "/v0/web-search/backends/"+backend+"/key", payload, "")
		return code, body
	}
	if code, body := saveKey("brave", "brave-bad", cardID); code != http.StatusBadRequest || !strings.Contains(string(body), "WEB_SEARCH_KEY_REJECTED") {
		t.Fatalf("refused key from the card: %d %s", code, body)
	}
	if got := countRows(t, env, `SELECT count(*) FROM web_search_keys`); got != 0 {
		t.Fatalf("a refused key was saved")
	}
	if got := countRows(t, env, `SELECT count(*) FROM decisions WHERE id=$1 AND status='pending'`, cardID); got != 1 {
		t.Fatalf("a refused key ended the card")
	}
	if code, body := saveKey("brave", "brave-good", cardID); code != http.StatusOK || !strings.Contains(string(body), `"key_state":"verified"`) {
		t.Fatalf("key from the card: %d %s", code, body)
	}
	assertBrowserCardHandoff(t, env, cardID, cardMessage, "answered", `"backend": "brave"`,
		`The user added a Brave Search API key. Results of your search for "rust releases" are in the payload below`)
	assertBrowserCardHandoff(t, env, cardID, cardMessage, "answered", `"decision": "configured"`, `"url":"https://rust.example/news"`)

	status, body = search(map[string]any{"query": "rust", "backend": "tavily"})
	decode(t, body, &failure)
	if status != http.StatusConflict || failure.Error.Details.InteractionID == cardID {
		t.Fatalf("tavily search without a key: %d %s", status, body)
	}
	tavilyCard, tavilyMessage := failure.Error.Details.InteractionID, failure.Error.Details.MessageID
	if code, body := saveKey("tavily", "tvly-good", ""); code != http.StatusOK || !strings.Contains(string(body), `"remaining":990`) {
		t.Fatalf("key from Connectors: %d %s", code, body)
	}
	assertBrowserCardHandoff(t, env, tavilyCard, tavilyMessage, "answered", `"backend": "tavily"`,
		"The user added a Tavily API key. Run the command again.\npayload={\"decision\":\"configured\",\"backend\":\"tavily\"}")

	status, body = search(map[string]any{"query": "rust", "backend": "brave", "limit": 5})
	if status != http.StatusOK || !strings.Contains(string(body), "release notes") {
		t.Fatalf("search with the saved key: %d %s", status, body)
	}
	if status, body = search(map[string]any{"query": "rust", "backend": "brave", "sites": []string{"a.example", "b.example"}}); status != http.StatusBadRequest {
		t.Fatalf("two sites on Brave: %d %s", status, body)
	}

	// The keyless DuckDuckGo can be the chosen default, and an Exa key, which
	// Exa has no endpoint to check, is saved unverified without a call.
	code, _, chosen := env.request(alice, http.MethodPut, "/v0/web-search/default", map[string]any{"backend": "duckduckgo"}, "")
	if code != http.StatusOK || !strings.Contains(string(chosen), `"chosen_default_search":"duckduckgo"`) {
		t.Fatalf("DuckDuckGo as the default: %d %s", code, chosen)
	}
	if code, body := saveKey("exa", "exa-key", ""); code != http.StatusOK || !strings.Contains(string(body), `"key_state":"unverified"`) {
		t.Fatalf("Exa key from Connectors: %d %s", code, body)
	}
}
