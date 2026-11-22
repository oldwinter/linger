package websearch

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"golang.org/x/net/html"
)

// duckDuckGoRecency maps the contract's recency to DuckDuckGo's df values.
var duckDuckGoRecency = map[string]string{"day": "d", "week": "w", "month": "m", "year": "y"}

// duckDuckGoSearch posts the query to DuckDuckGo's HTML results page, which
// needs no key. DuckDuckGo answers a GET from a script, and a POST that comes
// too soon after the last, with a 202 challenge page instead of results;
// that is a rate limit.
func (p *providers) duckDuckGoSearch(ctx context.Context, request Request) (Outcome, error) {
	query := request.Query
	if len(request.Sites) == 1 {
		query += " site:" + request.Sites[0]
	}
	form := url.Values{"q": {query}, "kl": {"wt-wt"}}
	if df := duckDuckGoRecency[request.Recency]; df != "" {
		form.Set("df", df)
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	call, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoints.DuckDuckGo+"/html/", strings.NewReader(form.Encode()))
	if err != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	call.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	call.Header.Set("Accept", "text/html")
	response, err := p.client.Do(call)
	if err != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBody))
	if err != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	switch {
	case response.StatusCode == http.StatusAccepted || response.StatusCode == http.StatusTooManyRequests:
		return Outcome{}, &Failure{Code: CodeRateLimited, RetryAfter: retryAfter(response.Header)}
	case response.StatusCode != http.StatusOK:
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	results, challenged, err := duckDuckGoResults(body)
	switch {
	case err != nil:
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	case challenged:
		return Outcome{}, &Failure{Code: CodeRateLimited}
	}
	return Outcome{Results: limitResults(results, request.Limit)}, nil
}

// duckDuckGoResults reads the organic results of a results page, skipping
// ads. challenged reports the bot challenge DuckDuckGo sometimes serves with
// 200.
func duckDuckGoResults(page []byte) (results []Result, challenged bool, err error) {
	root, err := html.Parse(bytes.NewReader(page))
	if err != nil {
		return nil, false, err
	}
	for node := range root.Descendants() {
		if node.Type != html.ElementNode {
			continue
		}
		if node.Data == "form" && attribute(node, "id") == "challenge-form" {
			return nil, true, nil
		}
		classes := strings.Fields(attribute(node, "class"))
		if node.Data != "div" || !slices.Contains(classes, "result") || slices.Contains(classes, "result--ad") {
			continue
		}
		var title, link, snippet string
		for inner := range node.Descendants() {
			if inner.Type != html.ElementNode || inner.Data != "a" {
				continue
			}
			switch innerClasses := strings.Fields(attribute(inner, "class")); {
			case slices.Contains(innerClasses, "result__a"):
				title, link = textOf(inner), duckDuckGoLink(attribute(inner, "href"))
			case slices.Contains(innerClasses, "result__snippet"):
				snippet = textOf(inner)
			}
		}
		results = appendResult(results, title, link, snippet, "")
	}
	return results, false, nil
}

// duckDuckGoLink unwraps the redirect link DuckDuckGo uses for some results.
func duckDuckGoLink(href string) string {
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if strings.HasSuffix(parsed.Host, "duckduckgo.com") && parsed.Path == "/l/" {
		return parsed.Query().Get("uddg")
	}
	return href
}

func attribute(node *html.Node, name string) string {
	for _, attr := range node.Attr {
		if attr.Key == name {
			return attr.Val
		}
	}
	return ""
}

func textOf(node *html.Node) string {
	var text strings.Builder
	for inner := range node.Descendants() {
		if inner.Type == html.TextNode {
			text.WriteString(inner.Data)
		}
	}
	return text.String()
}
