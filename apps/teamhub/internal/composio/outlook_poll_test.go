package composio

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOutlookDeltaReadsHeadersAndKeepsProviderCursor(t *testing.T) {
	var selects []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Endpoint   string `json:"endpoint"`
			Parameters []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"parameters"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		selected := ""
		for _, parameter := range request.Parameters {
			if parameter.Name == "$select" {
				selected = parameter.Value
			}
		}
		selects = append(selects, selected)
		_, _ = w.Write([]byte(`{"status":200,"headers":{},"data":{"value":[
			{"id":"o1","subject":"Your payment failed","bodyPreview":"Update your card within 3 days or your account will be suspended.",
			 "from":{"emailAddress":{"name":"AWS Billing","address":"no-reply@aws.amazon.com"}},
			 "toRecipients":[{"emailAddress":{"name":"Tony","address":"tony@example.com"}},{"emailAddress":{"name":"","address":"ops@example.com"}}],
			 "createdDateTime":"2026-10-26T08:00:00Z","receivedDateTime":"2026-10-26T08:00:00Z"},
			{"id":"o2","subject":"hi","from":{"emailAddress":{"name":"bob@example.com","address":"bob@example.com"}}}
		],"@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=t1"}}`))
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, APIKey: "restricted-key", EnvironmentKey: "test", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	client.SetConnectionAuthority(func(context.Context, string) (ConnectionBinding, error) {
		return ConnectionBinding{UserID: client.UserIDForAccount("account_1"), ToolkitSlug: "outlook", AuthConfigID: "ac_1"}, nil
	})
	messages, _, deltaLink, err := client.ListOutlookMessageDelta(context.Background(), "ca_1", "")
	if err != nil || deltaLink == "" || len(messages) != 2 {
		t.Fatalf("messages=%+v deltaLink=%q err=%v", messages, deltaLink, err)
	}
	mail := messages[0]
	if mail.From != "AWS Billing <no-reply@aws.amazon.com>" || mail.To != "Tony <tony@example.com>, ops@example.com" ||
		mail.Subject != "Your payment failed" {
		t.Fatalf("mail=%+v", mail)
	}
	if messages[1].From != "bob@example.com" {
		t.Fatalf("a sender named by its address must not repeat it: %+v", messages[1])
	}
	// The chain continues from the deltaLink, which carries the selection itself.
	if _, _, _, err := client.ListOutlookMessageDelta(context.Background(), "ca_1", deltaLink); err != nil {
		t.Fatal(err)
	}
	if len(selects) != 2 || selects[0] != outlookDeltaFields || selects[1] != "" {
		t.Fatalf("$select per request=%q", selects)
	}
}

func TestGraphPollContinuationKeepsOpaqueValuesAndRejectsOtherHosts(t *testing.T) {
	request, err := graphPollRequest("ca", "https://graph.microsoft.com/v1.0/teams/T/channels/C%2FD/messages?$skiptoken=a%2Bb%2Fc")
	if err != nil || request.Endpoint != "/v1.0/teams/T/channels/C%2FD/messages" || len(request.Parameters) != 1 || request.Parameters[0].Value != "a+b/c" {
		t.Fatalf("request=%+v error=%v", request, err)
	}
	if _, err := graphPollRequest("ca", "https://unrelated.example/v1.0/messages"); err == nil {
		t.Fatal("foreign continuation host accepted")
	}
}

func TestOutlookCalendarDeltaNormalizesEventsAndKeepsContinuation(t *testing.T) {
	type captured struct {
		endpoint string
		params   map[string]string
		headers  map[string]string
	}
	var calls []captured
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Endpoint   string `json:"endpoint"`
			Parameters []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
				Type  string `json:"type"`
			} `json:"parameters"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		entry := captured{endpoint: request.Endpoint, params: map[string]string{}, headers: map[string]string{}}
		for _, p := range request.Parameters {
			if p.Type == "header" {
				entry.headers[p.Name] = p.Value
			} else {
				entry.params[p.Name] = p.Value
			}
		}
		calls = append(calls, entry)
		if len(calls) == 3 {
			_, _ = w.Write([]byte(`{"status":410,"headers":{},"data":{}}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":200,"headers":{},"data":{"value":[
			{"id":"evt1","subject":"Design review","isAllDay":false,"isCancelled":false,
			 "createdDateTime":"2026-10-26T08:00:00Z","lastModifiedDateTime":"2026-10-26T09:00:00Z",
			 "start":{"dateTime":"2026-10-27T10:00:00.0000000","timeZone":"UTC"},
			 "end":{"dateTime":"2026-10-27T11:00:00.0000000","timeZone":"UTC"},
			 "location":{"displayName":"Room 2"},
			 "organizer":{"emailAddress":{"name":"Alice","address":"alice@example.com"}},
			 "body":{"contentType":"html","content":"<style>noise</style><p>Bring the contract.</p>"}},
			{"id":"evt2","subject":"Company offsite","isAllDay":true,
			 "start":{"dateTime":"2026-10-28T00:00:00.0000000","timeZone":"UTC"},
			 "end":{"dateTime":"2026-10-29T00:00:00.0000000","timeZone":"UTC"},
			 "body":{"contentType":"html","content":"<div class=\"PlainText\">&nbsp;</div>"},
			 "bodyPreview":"All hands day"},
			{"id":"evt3","@removed":{"reason":"deleted"}}
		],"@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=cal1"}}`))
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, APIKey: "restricted-key", EnvironmentKey: "test", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	client.SetConnectionAuthority(func(context.Context, string) (ConnectionBinding, error) {
		return ConnectionBinding{UserID: client.UserIDForAccount("account_1"), ToolkitSlug: "outlook", AuthConfigID: "ac_1"}, nil
	})
	start := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, 4, 25, 0, 0, 0, 0, time.UTC)
	changes, nextLink, deltaLink, err := client.ListOutlookCalendarDelta(context.Background(), "ca_1", "primary", start, end, "")
	if err != nil || nextLink != "" || deltaLink == "" || len(changes) != 3 {
		t.Fatalf("changes=%+v next=%q delta=%q err=%v", changes, nextLink, deltaLink, err)
	}
	if calls[0].endpoint != "/v1.0/me/calendarView/delta" ||
		calls[0].params["startDateTime"] != "2026-10-25T00:00:00Z" ||
		calls[0].params["endDateTime"] != "2027-04-25T00:00:00Z" ||
		calls[0].headers["Prefer"] != outlookCalendarPreferHeader {
		t.Fatalf("initial request=%+v", calls[0])
	}
	if changes[0].Start != "2026-10-27T10:00:00Z" || changes[0].End != "2026-10-27T11:00:00Z" ||
		changes[0].Location != "Room 2" || changes[0].Organizer != "Alice <alice@example.com>" ||
		changes[0].Description != "Bring the contract." {
		t.Fatalf("event 0=%+v", changes[0])
	}
	if changes[1].Start != "2026-10-28" || changes[1].End != "2026-10-29" || changes[1].Description != "All hands day" {
		t.Fatalf("all-day event=%+v", changes[1])
	}
	if !changes[2].Removed || changes[2].RemovedReason != "deleted" {
		t.Fatalf("removed event=%+v", changes[2])
	}

	// Continuation follows Graph's deltaLink without re-sending window query params.
	if _, _, _, err := client.ListOutlookCalendarDelta(context.Background(), "ca_1", "primary", start, end, deltaLink); err != nil {
		t.Fatal(err)
	}
	if calls[1].params["$deltatoken"] != "cal1" || calls[1].params["startDateTime"] != "" || calls[1].headers["Prefer"] != outlookCalendarPreferHeader {
		t.Fatalf("continuation request=%+v", calls[1])
	}

	// HTTP 410 Gone signals an expired delta token.
	if _, _, _, err := client.ListOutlookCalendarDelta(context.Background(), "ca_1", "primary", start, end, deltaLink); !errors.Is(err, ErrOutlookDeltaExpired) {
		t.Fatalf("410 error=%v, want ErrOutlookDeltaExpired", err)
	}
}
