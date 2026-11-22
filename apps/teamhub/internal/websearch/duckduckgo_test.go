package websearch

import (
	"errors"
	"net/http"
	"slices"
	"testing"
)

const duckDuckGoPage = `<html><body><div id="links" class="results">
<div class="result results_links result--ad"><a class="result__a" href="https://ads.example/buy">Sponsored</a>
<a class="result__snippet" href="https://ads.example/buy">buy now</a></div>
<div class="result results_links results_links_deep web-result">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="https://www.postgresql.org/docs/release/">Release <b>Notes</b> &amp; more</a></h2>
<a class="result__snippet" href="https://www.postgresql.org/docs/release/">Every <b>release</b> of PostgreSQL.</a></div>
<div class="result results_links web-result">
<h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwiki.example%2Fpg%3Fa%3D1&amp;rut=x">Wiki</a></h2>
<a class="result__snippet">From the wiki.</a></div>
<div class="result results_links web-result"><a class="result__a" href="javascript:alert(1)">bad</a></div>
</div></body></html>`

func TestDuckDuckGoSearchPostsTheQueryAndReadsOrganicResults(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		if r.method != http.MethodPost || r.path != "/ddg/html/" || r.query != "" {
			t.Errorf("request = %s %s?%s", r.method, r.path, r.query)
		}
		_, _ = w.Write([]byte(duckDuckGoPage))
	})
	s, _ := newTestService(t, fake)
	request, err := Normalize(Request{Command: CommandSearch, Backend: DuckDuckGo, Query: "release notes", Recency: "month",
		Sites: []string{"PostgreSQL.org"}})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := s.Run(t.Context(), request)
	if err != nil || outcome.Backend != DuckDuckGo {
		t.Fatalf("Run = %+v, %v", outcome, err)
	}
	want := []Result{
		{Title: "Release Notes & more", URL: "https://www.postgresql.org/docs/release/", Snippet: "Every release of PostgreSQL."},
		{Title: "Wiki", URL: "https://wiki.example/pg?a=1", Snippet: "From the wiki."},
	}
	if !slices.Equal(outcome.Results, want) {
		t.Fatalf("results = %+v", outcome.Results)
	}
	form := fake.seen()[0].form
	if form.Get("q") != "release notes site:postgresql.org" || form.Get("df") != "m" || form.Get("kl") != "wt-wt" {
		t.Fatalf("form = %v", form)
	}
}

func TestDuckDuckGoIsTheDefaultWithoutAKey(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		if r.path != "/ddg/html/" {
			t.Errorf("unexpected %s", r.path)
		}
		_, _ = w.Write([]byte(duckDuckGoPage))
	})
	s, keys := newTestService(t, fake)
	outcome, err := s.Run(t.Context(), search("pg"))
	if err != nil || outcome.Backend != DuckDuckGo || len(outcome.Results) != 2 {
		t.Fatalf("Run without keys = %+v, %v", outcome, err)
	}
	saveRaw(t, s, keys, Tavily, "provider-secret", "verified")
	if list, err := s.List(t.Context(), false); err != nil || list.DefaultSearch != Tavily {
		t.Fatalf("default with a Tavily key = %q, %v", list.DefaultSearch, err)
	}
	chosen, err := s.SetDefault(t.Context(), DuckDuckGo)
	if err != nil || chosen.DefaultSearch != DuckDuckGo || chosen.ChosenDefault != DuckDuckGo {
		t.Fatalf("SetDefault = %+v, %v", chosen, err)
	}
	if err := s.RemoveKey(t.Context(), DuckDuckGo); !errors.Is(err, ErrInvalid) {
		t.Fatalf("RemoveKey = %v", err)
	}
	if _, err := s.SaveKey(t.Context(), DuckDuckGo, "provider-secret"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("SaveKey = %v", err)
	}
}

func TestDuckDuckGoChallengeIsARateLimit(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"202 challenge", http.StatusAccepted, `<form id="challenge-form" method="POST"></form>`},
		{"200 challenge", http.StatusOK, `<html><form id="challenge-form"></form></html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			})
			s, _ := newTestService(t, fake)
			request := search("pg")
			request.Backend = DuckDuckGo
			_, err := s.Run(t.Context(), request)
			var failure *Failure
			if !errors.As(err, &failure) || failure.Code != CodeRateLimited || failure.Backend != DuckDuckGo ||
				!slices.Equal(failure.Ready, []Backend{You}) {
				t.Fatalf("Run = %#v", err)
			}
		})
	}
}

func TestDuckDuckGoRefusesWhatItsPageCannotHonor(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		t.Errorf("unexpected %s", r.path)
	})
	s, _ := newTestService(t, fake)
	for _, request := range []Request{
		{Command: CommandSearch, Backend: DuckDuckGo, Query: "pg", Limit: 11},
		{Command: CommandSearch, Backend: DuckDuckGo, Query: "pg", Sites: []string{"a.example", "b.example"}},
	} {
		normalized, err := Normalize(request)
		if err != nil {
			t.Fatal(err)
		}
		var failure *Failure
		if _, err := s.Run(t.Context(), normalized); !errors.As(err, &failure) || failure.Code != CodeUnsupported {
			t.Fatalf("Run(%+v) = %v", request, err)
		}
	}
}
