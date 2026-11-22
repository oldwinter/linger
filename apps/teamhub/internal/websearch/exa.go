package websearch

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func exaHeader(key string) map[string]string { return map[string]string{"x-api-key": key} }

// exaRecency is how far back each recency reaches; Exa filters by a start
// date instead of a named range.
var exaRecency = map[string]time.Duration{
	"day": 24 * time.Hour, "week": 7 * 24 * time.Hour, "month": 30 * 24 * time.Hour, "year": 365 * 24 * time.Hour,
}

// exaSearch asks Exa for results with highlights, which serve as snippets.
func (p *providers) exaSearch(ctx context.Context, key string, request Request) (Outcome, error) {
	body := map[string]any{
		"query": request.Query, "type": "auto", "numResults": request.Limit,
		"contents": map[string]any{"highlights": map[string]any{"maxCharacters": maxSnippetRunes}},
	}
	if span, ok := exaRecency[request.Recency]; ok {
		body["startPublishedDate"] = time.Now().UTC().Add(-span).Format(time.RFC3339)
	}
	if len(request.Sites) > 0 {
		body["includeDomains"] = request.Sites
	}
	a, err := p.call(ctx, http.MethodPost, p.endpoints.Exa+"/search", exaHeader(key), body)
	if err != nil {
		return Outcome{}, err
	}
	if err := classify(Exa, CommandSearch, a); err != nil {
		return Outcome{}, err
	}
	var decoded struct {
		Results []struct {
			Title         string   `json:"title"`
			URL           string   `json:"url"`
			PublishedDate string   `json:"publishedDate"`
			Highlights    []string `json:"highlights"`
		} `json:"results"`
	}
	if json.Unmarshal(a.body, &decoded) != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	results := make([]Result, 0, len(decoded.Results))
	for _, item := range decoded.Results {
		results = appendResult(results, item.Title, item.URL, strings.Join(item.Highlights, " "), item.PublishedDate)
	}
	return Outcome{Results: limitResults(results, request.Limit)}, nil
}

// exaContents reads one page as Markdown with its links kept. Exa reports a
// page it could not fetch in statuses with 200, so that is checked too. One
// character past MaxMarkdown is asked for so a cut page is marked truncated.
func (p *providers) exaContents(ctx context.Context, key, pageURL string) (Outcome, error) {
	a, err := p.call(ctx, http.MethodPost, p.endpoints.Exa+"/contents", exaHeader(key), map[string]any{
		"urls": []string{pageURL}, "text": map[string]any{"maxCharacters": MaxMarkdown + 1, "linkStyle": "full"},
	})
	if err != nil {
		return Outcome{}, err
	}
	if err := classify(Exa, CommandOpen, a); err != nil {
		return Outcome{}, err
	}
	var decoded struct {
		Results []struct {
			URL   string `json:"url"`
			Title string `json:"title"`
			Text  string `json:"text"`
		} `json:"results"`
		Statuses []struct {
			Status string `json:"status"`
		} `json:"statuses"`
	}
	if json.Unmarshal(a.body, &decoded) != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	if len(decoded.Results) == 0 || len(decoded.Statuses) > 0 && decoded.Statuses[0].Status == "error" {
		return Outcome{}, &Failure{Code: CodePageUnreadable}
	}
	item := decoded.Results[0]
	return pageOutcome(pageURL, item.URL, item.Title, item.Text)
}
