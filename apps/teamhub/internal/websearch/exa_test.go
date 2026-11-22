package websearch

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestExaSearchSendsItsRequestAndReadsHighlights(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		if r.path != "/exa/search" {
			t.Errorf("unexpected %s", r.path)
		}
		writeJSON(w, 200, `{"results":[{"title":"E","url":"https://e.example/a","publishedDate":"2026-11-02T00:00:00.000Z",
			"highlights":["first part.","second part."]},{"title":"bad","url":"ftp://e.example"}],"costDollars":{"total":0.008}}`)
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Exa, "exa-secret", "unverified")
	request, err := Normalize(Request{Command: CommandSearch, Backend: Exa, Query: "q", Limit: 4, Recency: "week",
		Sites: []string{"a.example", "b.example"}})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := s.Run(t.Context(), request)
	want := Result{Title: "E", URL: "https://e.example/a", Snippet: "first part. second part.", PublishedAt: "2026-11-02T00:00:00.000Z"}
	if err != nil || outcome.Backend != Exa || len(outcome.Results) != 1 || outcome.Results[0] != want {
		t.Fatalf("Run = %+v, %v", outcome, err)
	}
	body := fake.seen()[0].body
	since, err := time.Parse(time.RFC3339, body["startPublishedDate"].(string))
	if fake.seen()[0].apiKey != "exa-secret" || body["numResults"] != float64(4) || body["type"] != "auto" ||
		len(body["includeDomains"].([]any)) != 2 || err != nil || time.Since(since) < 6*24*time.Hour || time.Since(since) > 8*24*time.Hour ||
		body["contents"].(map[string]any)["highlights"] == nil {
		t.Fatalf("exa request = %+v", body)
	}
	// A successful call proves a key Exa has no endpoint to check.
	if keys.rows[string(Exa)].State != "verified" {
		t.Fatalf("state after a call = %q", keys.rows[string(Exa)].State)
	}
}

func TestExaContentsReadsThePageOrReportsItUnreadable(t *testing.T) {
	long := strings.Repeat("x", MaxMarkdown+1)
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.body["urls"].([]any)[0] {
		case "https://e.example/long":
			if r.body["text"].(map[string]any)["maxCharacters"] != float64(MaxMarkdown+1) {
				t.Errorf("contents body = %+v", r.body)
			}
			writeJSON(w, 200, `{"results":[{"url":"https://e.example/long","title":"Long","text":"`+long+`"}],
				"statuses":[{"id":"https://e.example/long","status":"success","source":"crawled"}]}`)
		default:
			writeJSON(w, 200, `{"results":[],"statuses":[{"id":"https://e.example/gone","status":"error","error":{"tag":"CRAWL_NOT_FOUND","httpStatusCode":404}}]}`)
		}
	})
	s, keys := newTestService(t, fake)
	saveRaw(t, s, keys, Exa, "exa-secret", "verified")
	open := func(link string) (Outcome, error) {
		request, err := Normalize(Request{Command: CommandOpen, Backend: Exa, URL: link})
		if err != nil {
			t.Fatal(err)
		}
		return s.Run(t.Context(), request)
	}
	outcome, err := open("https://e.example/long")
	if err != nil || outcome.Page.Title != "Long" || !outcome.Page.Truncated || len(outcome.Page.Markdown) != MaxMarkdown {
		t.Fatalf("long page = %v", err)
	}
	var failure *Failure
	if _, err := open("https://e.example/gone"); !errors.As(err, &failure) || failure.Code != CodePageUnreadable {
		t.Fatalf("gone page = %#v", err)
	}
}

func TestExaKeyIsSavedUnverifiedAndRefusedOn401(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		writeJSON(w, 401, `{"requestId":"r","error":"Invalid API key","tag":"INVALID_API_KEY"}`)
	})
	s, keys := newTestService(t, fake)
	view, err := s.SaveKey(t.Context(), Exa, "exa-secret")
	if err != nil || view.KeyState != "unverified" || view.OfficialKeyCheck || view.Description == "" || len(fake.seen()) != 0 {
		t.Fatalf("SaveKey = %+v, %v, calls %d", view, err, len(fake.seen()))
	}
	list, err := s.List(t.Context(), true)
	if err != nil || len(fake.seen()) != 0 {
		t.Fatalf("List called a provider: %v", err)
	}
	for _, v := range list.Backends {
		if v.ID == Exa && (v.Status != "ready" || v.Quota.Reason != "not_reported") {
			t.Fatalf("exa = %+v", v)
		}
	}
	request := search("q")
	request.Backend = Exa
	_, err = s.Run(t.Context(), request)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodeKeyRejected || keys.rows[string(Exa)].State != "rejected" {
		t.Fatalf("Run = %#v, state %q", err, keys.rows[string(Exa)].State)
	}
}
