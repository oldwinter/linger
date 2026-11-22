package composio

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDiscordAndGoogleCalendarProxyPaginationAndRendering(t *testing.T) {
	var requests []proxyRequest
	toolRequests := map[string]discordToolRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if slug, ok := strings.CutPrefix(r.URL.Path, "/api/v3.1/tools/execute/DISCORDBOT_"); ok {
			var request discordToolRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || r.Method != http.MethodPost {
				t.Errorf("tool request %s err=%v", r.Method, err)
			}
			toolRequests[slug] = request
			var data json.RawMessage
			switch slug {
			case "GET_CONNECTED_GUILD":
				data = json.RawMessage(`{"id":"GUILD","name":"Workspace Guild"}`)
			case "LIST_GUILD_CHANNELS":
				data = json.RawMessage(`{"channels":[{"id":"channel-1","guild_id":"GUILD","parent_id":null,"name":"product","type":0},{"id":"voice-1","guild_id":"GUILD","name":"standup","type":2}]}`)
			case "GET_ACTIVE_GUILD_THREADS":
				data = json.RawMessage(`{"threads":[{"id":"thread-1","guild_id":"GUILD","parent_id":"channel-1","name":"launch","type":11,"thread_metadata":{"archive_timestamp":"2026-08-10T10:00:00Z"}}],"has_more":false,"members":[]}`)
			case "LIST_PUBLIC_ARCHIVED_THREADS":
				data = json.RawMessage(`{"threads":[{"id":"thread-2","guild_id":"GUILD","parent_id":"channel-1","name":"archive","type":11,"thread_metadata":{"archive_timestamp":"2026-08-09T10:00:00Z"}}],"has_more":true}`)
			case "LIST_MESSAGES":
				data = json.RawMessage(`{"messages":[{"id":"message-1","channel_id":"channel-1","content":"Hello <team>","timestamp":"2026-08-10T08:30:00Z","edited_timestamp":null,"type":0,"author":{"id":"user-1","username":"alice","global_name":"Alice","bot":false},"member":{"nick":"Alice P"},"attachments":[]}]}`)
			default:
				t.Errorf("unexpected Discord tool %s", slug)
			}
			data = json.RawMessage(strings.ReplaceAll(string(data), "GUILD", "1537440822578913330"))
			_ = json.NewEncoder(w).Encode(map[string]any{"successful": true, "data": data})
			return
		}
		var request proxyRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode proxy request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests = append(requests, request)
		var data json.RawMessage
		switch request.Endpoint {
		case "/users/me/calendarList/primary":
			data = json.RawMessage(`{"id":"primary@example.test","summary":"Alice","timeZone":"Asia/Shanghai","primary":true}`)
		case "/users/me/calendarList":
			data = json.RawMessage(`{"items":[{"id":"team@example.test","summary":"Team","timeZone":"Asia/Shanghai","accessRole":"reader","primary":false,"selected":true}],"nextPageToken":"next-calendar"}`)
		case "/calendars/team@example.test/events":
			data = json.RawMessage(`{"items":[{"id":"event-1","iCalUID":"uid-1","status":"cancelled","summary":"Planning","description":"Agenda","location":"Room A","htmlLink":"https://calendar.test/event-1","hangoutLink":"https://meet.test/room","created":"2026-08-09T01:00:00Z","updated":"2026-08-10T01:00:00Z","start":{"dateTime":"2026-08-10T09:00:00+08:00","timeZone":"Asia/Shanghai"},"end":{"dateTime":"2026-08-10T10:00:00+08:00","timeZone":"Asia/Shanghai"},"creator":{"email":"creator@example.test","displayName":"Creator"},"organizer":{"email":"owner@example.test","displayName":"Owner","organizer":true},"attendees":[{"email":"guest@example.test","displayName":"Guest","responseStatus":"accepted"}]}],"nextPageToken":"next-event"}`)
		default:
			t.Errorf("unexpected endpoint %s", request.Endpoint)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(proxyResponse{Status: http.StatusOK, Data: data})
	}))
	defer server.Close()

	client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "key", HTTPClient: server.Client(), RetryLimit: -1})
	if err != nil {
		t.Fatal(err)
	}
	client.SetConnectionAuthority(func(context.Context, string) (ConnectionBinding, error) {
		return ConnectionBinding{UserID: "binding-user"}, nil
	})
	ctx := context.Background()
	start, end := time.Date(2026, 8, 9, 0, 0, 0, 0, time.UTC), time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC)

	discordIdentity, err := client.IdentifyDiscord(ctx, "discord-account")
	if err != nil || discordIdentity.GuildID != "1537440822578913330" {
		t.Fatalf("Discord identity=%+v err=%v", discordIdentity, err)
	}
	channels, err := client.ListDiscordChannels(ctx, "discord-account", discordIdentity.GuildID)
	if err != nil || len(channels) != 1 || channels[0].ID != "channel-1" {
		t.Fatalf("Discord channels=%+v err=%v", channels, err)
	}
	activeThreads, err := client.ListDiscordActiveThreads(ctx, "discord-account", discordIdentity.GuildID)
	if err != nil || len(activeThreads) != 1 || activeThreads[0].ParentID != "channel-1" {
		t.Fatalf("Discord active threads=%+v err=%v", activeThreads, err)
	}
	archivedThreads, err := client.ListDiscordArchivedThreads(ctx, "discord-account", discordIdentity.GuildID, "channel-1", "archive-cursor", 100)
	if err != nil || archivedThreads.NextCursor != "2026-08-09T10:00:00Z" || len(archivedThreads.Threads) != 1 || archivedThreads.Threads[0].ArchivedAt.IsZero() {
		t.Fatalf("Discord archived threads=%+v err=%v", archivedThreads, err)
	}
	messages, err := client.ListDiscordMessages(ctx, "discord-account", "channel-1", "message-cursor", 1)
	if err != nil || messages.NextBefore != "message-1" || len(messages.Messages) != 1 || messages.Messages[0].AuthorName != "Alice P" {
		t.Fatalf("Discord messages=%+v err=%v", messages, err)
	}
	discordDocuments, err := RenderDiscordDocumentsWithLimits(discordIdentity, map[string]DiscordChannel{"channel-1": channels[0]}, messages.Messages, DefaultAppImportLimits())
	if err != nil || len(discordDocuments) != 1 || !strings.Contains(string(discordDocuments[0].Markdown), "Author: Alice P") || !strings.Contains(string(discordDocuments[0].Markdown), "Hello <team>") || !strings.Contains(string(discordDocuments[0].Markdown), "discord.com/channels/1537440822578913330/channel-1/message-1") {
		t.Fatalf("Discord documents=%+v err=%v", discordDocuments, err)
	}

	calendarIdentity, err := client.IdentifyGoogleCalendar(ctx, "calendar-account")
	if err != nil || calendarIdentity.CalendarID != "primary@example.test" {
		t.Fatalf("Calendar identity=%+v err=%v", calendarIdentity, err)
	}
	calendarPage, err := client.ListGoogleCalendars(ctx, "calendar-account", "calendar-cursor", 100)
	if err != nil || calendarPage.NextPageToken != "next-calendar" || len(calendarPage.Calendars) != 1 {
		t.Fatalf("Calendar page=%+v err=%v", calendarPage, err)
	}
	eventPage, err := client.ListGoogleCalendarEvents(ctx, "calendar-account", "team@example.test", "event-cursor", start, end, 100)
	if err != nil || eventPage.NextPageToken != "next-event" || len(eventPage.Events) != 1 || eventPage.Events[0].Attendees[0].ResponseStatus != "accepted" {
		t.Fatalf("Calendar event page=%+v err=%v", eventPage, err)
	}
	calendarDocuments, err := RenderGoogleCalendarDocumentsWithLimits(calendarIdentity, map[string]GoogleCalendar{"team@example.test": calendarPage.Calendars[0]}, map[string][]GoogleCalendarEvent{"team@example.test": eventPage.Events}, DefaultAppImportLimits())
	if err != nil || len(calendarDocuments) != 1 || !strings.Contains(string(calendarDocuments[0].Markdown), "Status: cancelled") || !strings.Contains(string(calendarDocuments[0].Markdown), "iCal UID: uid-1") || !strings.Contains(string(calendarDocuments[0].Markdown), "Invitee: Guest <guest@example.test> [accepted]") {
		t.Fatalf("Calendar documents=%+v err=%v", calendarDocuments, err)
	}

	firstPage, err := client.ListDiscordMessages(ctx, "discord-account", "channel-1", "", 100)
	if err != nil || firstPage.NextBefore != "" || !firstPage.Messages[0].EditedTimestamp.IsZero() {
		t.Fatalf("Discord first message page=%+v err=%v", firstPage, err)
	}
	wantArguments := map[string]map[string]any{
		"GET_CONNECTED_GUILD":          {},
		"LIST_GUILD_CHANNELS":          {"guild_id": "1537440822578913330"},
		"GET_ACTIVE_GUILD_THREADS":     {"guild_id": "1537440822578913330"},
		"LIST_PUBLIC_ARCHIVED_THREADS": {"channel_id": "channel-1", "limit": float64(100), "before": "archive-cursor"},
		"LIST_MESSAGES":                {"channel_id": "channel-1", "limit": float64(100)},
	}
	for slug, want := range wantArguments {
		request := toolRequests[slug]
		if request.ConnectedAccountID != "discord-account" || request.UserID != "binding-user" || request.Version != "20261116_00" || !reflect.DeepEqual(request.Arguments, want) {
			t.Fatalf("Discord tool %s request=%+v want arguments %v", slug, request, want)
		}
	}
	assertProxyParameter(t, requests, "/users/me/calendarList", "pageToken", "calendar-cursor")
	assertProxyParameter(t, requests, "/calendars/team@example.test/events", "pageToken", "event-cursor")
	for _, request := range requests {
		if strings.Contains(request.Endpoint, "/archived/private") {
			t.Fatalf("Discord private archive endpoint must not be used: %s", request.Endpoint)
		}
	}
}

func TestAppDocumentFilenamesAreBoundedAndPrincipalScoped(t *testing.T) {
	calendarIDs := []string{"team@example.test", "teamexampletest", strings.Repeat("calendar/", 80)}
	calendars := make(map[string]GoogleCalendar, len(calendarIDs))
	events := make(map[string][]GoogleCalendarEvent, len(calendarIDs))
	for _, calendarID := range calendarIDs {
		calendars[calendarID] = GoogleCalendar{ID: calendarID, Summary: strings.Repeat("Team calendar ", 40), TimeZone: "UTC"}
		events[calendarID] = []GoogleCalendarEvent{{ID: "event-" + calendarID, Status: "confirmed", StartDate: "2026-08-10", EndDate: "2026-08-11"}}
	}
	documents, err := RenderGoogleCalendarDocumentsWithLimits(GoogleCalendarIdentity{CalendarID: "primary@example.test", Label: "Primary"}, calendars, events, DefaultAppImportLimits())
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, document := range documents {
		if len(document.Filename) > 255 {
			t.Fatalf("Calendar filename is %d bytes: %q", len(document.Filename), document.Filename)
		}
		if seen[document.Filename] {
			t.Fatalf("Calendar identities collided on filename %q", document.Filename)
		}
		seen[document.Filename] = true
	}
}

func TestGoogleCalendarDeletedTombstoneWithoutStartRemainsImportable(t *testing.T) {
	documents, err := RenderGoogleCalendarDocumentsWithLimits(
		GoogleCalendarIdentity{CalendarID: "primary", Label: "Alice"},
		map[string]GoogleCalendar{"calendar": {ID: "calendar", Summary: "Team"}},
		map[string][]GoogleCalendarEvent{"calendar": {{ID: "deleted-1", Status: "cancelled"}}},
		DefaultAppImportLimits(),
	)
	if err != nil || len(documents) != 1 || documents[0].RemoteID != "google_calendar:calendar:cancelled" || !strings.Contains(string(documents[0].Markdown), "Status: cancelled") {
		t.Fatalf("deleted Calendar tombstone documents=%+v err=%v", documents, err)
	}
}

func newDiscordIdentityTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "key", HTTPClient: server.Client(), RetryLimit: -1})
	if err != nil {
		t.Fatal(err)
	}
	client.SetConnectionAuthority(func(context.Context, string) (ConnectionBinding, error) {
		return ConnectionBinding{UserID: "binding-user"}, nil
	})
	return client
}

func TestDiscordIdentityReadsConnectedGuildTool(t *testing.T) {
	for name, data := range map[string]any{
		"object": map[string]any{"id": "1537440822578913330", "name": "Workspace Guild", "owner_id": "1"},
		"string": `{"id":"1537440822578913330","name":"Workspace Guild"}`,
	} {
		t.Run(name, func(t *testing.T) {
			client := newDiscordIdentityTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/api/v3.1/tools/execute/DISCORDBOT_GET_CONNECTED_GUILD" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				var body struct {
					ConnectedAccountID string                     `json:"connected_account_id"`
					UserID             string                     `json:"user_id"`
					Version            string                     `json:"version"`
					Arguments          map[string]json.RawMessage `json:"arguments"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ConnectedAccountID != "discord-account" || body.UserID != "binding-user" || body.Version != "20261116_00" || body.Arguments == nil || len(body.Arguments) != 0 {
					t.Errorf("tool request=%+v err=%v", body, err)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"successful": true, "data": data})
			})
			identity, err := client.IdentifyDiscord(context.Background(), "discord-account")
			if err != nil || identity != (DiscordIdentity{GuildID: "1537440822578913330", GuildName: "Workspace Guild"}) {
				t.Fatalf("Discord identity=%+v err=%v", identity, err)
			}
		})
	}
}

func TestDiscordIdentityRejectsUnusableGuild(t *testing.T) {
	cases := map[string]struct {
		response     map[string]any
		guildMissing bool
	}{
		"unsuccessful":      {response: map[string]any{"successful": false, "data": map[string]string{"id": "1537440822578913330", "name": "Guild"}}},
		"array data":        {response: map[string]any{"successful": true, "data": []string{"1537440822578913330"}}},
		"number data":       {response: map[string]any{"successful": true, "data": 1537440822578913330}},
		"non-object string": {response: map[string]any{"successful": true, "data": "not json"}},
		"redacted id":       {response: map[string]any{"successful": true, "data": map[string]string{"id": "REDACTED", "name": "Guild"}}, guildMissing: true},
		"non-numeric id":    {response: map[string]any{"successful": true, "data": map[string]string{"id": "15374408225789133x0", "name": "Guild"}}, guildMissing: true},
		"short id":          {response: map[string]any{"successful": true, "data": map[string]string{"id": "1234567890", "name": "Guild"}}, guildMissing: true},
		"empty id":          {response: map[string]any{"successful": true, "data": map[string]string{"id": "", "name": "Guild"}}, guildMissing: true},
		"redacted name":     {response: map[string]any{"successful": true, "data": map[string]string{"id": "1537440822578913330", "name": "redacted"}}, guildMissing: true},
		"empty name":        {response: map[string]any{"successful": true, "data": map[string]string{"id": "1537440822578913330", "name": ""}}, guildMissing: true},
		"whitespace name":   {response: map[string]any{"successful": true, "data": map[string]string{"id": "1537440822578913330", "name": "  "}}, guildMissing: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			client := newDiscordIdentityTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v3.1/tools/execute/DISCORDBOT_GET_CONNECTED_GUILD" {
					t.Errorf("unexpected request %s", r.URL.Path)
				}
				_ = json.NewEncoder(w).Encode(tc.response)
			})
			_, err := client.IdentifyDiscord(context.Background(), "discord-account")
			if err == nil || errors.Is(err, ErrDiscordGuildRequired) != tc.guildMissing {
				t.Fatalf("Discord identity error=%v want guild required=%v", err, tc.guildMissing)
			}
		})
	}
}

func TestDiscordGuildMapsMissingOrForbiddenServerToAccessibleError(t *testing.T) {
	for _, remoteStatus := range []int{http.StatusForbidden, http.StatusNotFound} {
		t.Run(http.StatusText(remoteStatus), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v3.1/tools/execute/DISCORDBOT_GET_GUILD" {
					t.Errorf("unexpected request %s", r.URL.Path)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"successful": false, "error": "denied", "data": map[string]any{"message": "denied", "status_code": remoteStatus}})
			}))
			defer server.Close()
			client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "key", HTTPClient: server.Client(), RetryLimit: -1})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = client.GetDiscordGuild(context.Background(), "discord-account", "1537440822578913330"); !errors.Is(err, ErrDiscordGuildNotAccessible) {
				t.Fatalf("Discord guild error=%v want ErrDiscordGuildNotAccessible", err)
			}
		})
	}
}

type discordToolRequest struct {
	ConnectedAccountID string         `json:"connected_account_id"`
	UserID             string         `json:"user_id"`
	Version            string         `json:"version"`
	Arguments          map[string]any `json:"arguments"`
}

func TestDiscordToolFailureUsesStructuredStatus(t *testing.T) {
	for name, data := range map[string]any{
		"rate limited": map[string]any{"message": "slow down", "status_code": 429},
		"unauthorized": map[string]any{"message": "no", "status_code": 401},
		"no status":    map[string]any{"message": "Forbidden 403"},
	} {
		t.Run(name, func(t *testing.T) {
			client := newDiscordIdentityTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"successful": false, "error": "status 403", "data": data})
			})
			_, err := client.ListDiscordChannels(context.Background(), "discord-account", "1537440822578913330")
			var limited *RateLimitError
			_, hasStatus := ErrorStatus(err)
			switch name {
			case "rate limited":
				if !errors.As(err, &limited) {
					t.Fatalf("error=%v want RateLimitError", err)
				}
			case "unauthorized":
				if !IsAuthFailure(err) {
					t.Fatalf("error=%v want auth failure", err)
				}
			default:
				if err == nil || hasStatus || errors.As(err, &limited) {
					t.Fatalf("error=%v want plain error", err)
				}
			}
		})
	}
}

func TestAppProxyPreservesRateLimitForJobRetry(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		_ = json.NewEncoder(w).Encode(proxyResponse{Status: http.StatusTooManyRequests, Data: json.RawMessage(`{}`), Headers: map[string]string{"Retry-After": "17"}})
	}))
	defer server.Close()
	client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "key", HTTPClient: server.Client(), MaxRetryAfter: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	ctx, attempts := WithProviderAttemptBudget(context.Background(), 1)
	_, err = client.IdentifyGitHub(ctx, "account")
	var limited *RateLimitError
	if !errors.As(err, &limited) || limited.RetryAfter != 17*time.Second {
		t.Fatalf("rate limit error=%v", err)
	}
	if requests != 1 || attempts() != 1 {
		t.Fatalf("one-shot proxy requests=%d attempts=%d", requests, attempts())
	}
}

func TestAppProxyReservesBeforeHTTPRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		_ = json.NewEncoder(w).Encode(proxyResponse{Status: http.StatusOK, Data: json.RawMessage(`{"data":{"id":"user","name":"User","username":"user"}}`)})
	}))
	defer server.Close()
	client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "key", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	reserved := 0
	ctx := WithProviderAttemptReservation(context.Background(), func(context.Context) error {
		reserved++
		return ErrProviderCallBudgetExhausted
	})
	if _, err = client.IdentifyGitHub(ctx, "account"); !errors.Is(err, ErrProviderCallBudgetExhausted) {
		t.Fatalf("reservation error=%v", err)
	}
	if reserved != 1 || requests != 0 {
		t.Fatalf("reserved=%d requests=%d", reserved, requests)
	}
}

func TestAppImportContentLimitsFailBeforeOverflow(t *testing.T) {
	limits := AppImportLimits{MaxFieldBytes: 8, MaxDocumentBytes: 32, MaxBatchBytes: 48}
	budget := NewAppImportAccumulator(limits)
	if err := budget.AddRecord("12345678", "12345678"); err != nil {
		t.Fatal(err)
	}
	if err := budget.AddRecord("123456789"); !errors.Is(err, ErrAppImportTooLarge) {
		t.Fatalf("field limit error=%v", err)
	}
	if err := budget.AddRecord("12345678", "12345678", "12345678", "12345678"); err != nil {
		t.Fatal(err)
	}
	if err := budget.AddRecord("x"); !errors.Is(err, ErrAppImportTooLarge) {
		t.Fatalf("batch limit error=%v", err)
	}
	channels := map[string]DiscordChannel{"channel": {ID: "channel", GuildID: "guild", Name: "general"}}
	messages := []DiscordMessage{{ID: "message", ChannelID: "channel", Content: strings.Repeat("x", 16), AuthorID: "author", AuthorName: "Author", Timestamp: time.Date(2026, 8, 10, 1, 0, 0, 0, time.UTC)}}
	if _, err := RenderDiscordDocumentsWithLimits(DiscordIdentity{GuildID: "guild", GuildName: "Guild"}, channels, messages, AppImportLimits{MaxFieldBytes: 32, MaxDocumentBytes: 64, MaxBatchBytes: 64}); !errors.Is(err, ErrAppImportTooLarge) {
		t.Fatalf("render limit error=%v", err)
	}
}

func assertProxyParameter(t *testing.T, requests []proxyRequest, endpoint, name, value string) {
	t.Helper()
	for _, request := range requests {
		if request.Endpoint != endpoint {
			continue
		}
		for _, parameter := range request.Parameters {
			if parameter.Name == name && parameter.Value == value && parameter.Type == "query" {
				return
			}
		}
	}
	t.Fatalf("missing %s=%s query parameter for %s: %+v", name, value, endpoint, requests)
}

func TestDiscordChannelGuildReadsPinnedChannelTool(t *testing.T) {
	var request discordToolRequest
	client := newDiscordIdentityTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v3.1/tools/execute/DISCORDBOT_GET_CHANNEL" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"successful": true, "data": map[string]any{"id": "c1", "guild_id": "g1"}})
	})
	guildID, err := client.GetDiscordChannelGuild(context.Background(), "discord-account", "c1")
	want := discordToolRequest{ConnectedAccountID: "discord-account", UserID: "binding-user", Version: discordToolVersion, Arguments: map[string]any{"channel_id": "c1"}}
	if err != nil || guildID != "g1" || !reflect.DeepEqual(request, want) {
		t.Fatalf("guild=%q err=%v request=%+v", guildID, err, request)
	}
}

func TestDiscordChannelGuildClassifiesFailures(t *testing.T) {
	for name, response := range map[string]map[string]any{
		"missing guild":    {"successful": true, "data": map[string]any{"id": "c1"}},
		"non-string guild": {"successful": true, "data": map[string]any{"id": "c1", "guild_id": 7}},
		"refused":          {"successful": false, "data": map[string]any{"message": "no"}},
		"forbidden":        {"successful": false, "data": map[string]any{"status_code": 403}},
		"rate limited":     {"successful": false, "data": map[string]any{"status_code": 429}},
	} {
		t.Run(name, func(t *testing.T) {
			client := newDiscordIdentityTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(response)
			})
			guildID, err := client.GetDiscordChannelGuild(context.Background(), "discord-account", "c1")
			status, _ := ErrorStatus(err)
			var limited *RateLimitError
			var ok bool
			switch name {
			case "missing guild", "non-string guild":
				ok = errors.Is(err, ErrDiscordChannelGuildUnknown)
			case "refused":
				ok = errors.Is(err, ErrDiscordToolRefused)
			case "forbidden":
				ok = status == http.StatusForbidden && !errors.Is(err, ErrDiscordToolRefused)
			case "rate limited":
				ok = errors.As(err, &limited)
			}
			if !ok || guildID != "" {
				t.Fatalf("guild=%q err=%v", guildID, err)
			}
		})
	}
}

func TestDiscordChannelGuildRequiresChannelID(t *testing.T) {
	client := newDiscordIdentityTestClient(t, func(http.ResponseWriter, *http.Request) {
		t.Error("empty channel id reached Composio")
	})
	if _, err := client.GetDiscordChannelGuild(context.Background(), "discord-account", ""); err == nil {
		t.Fatal("empty channel id was accepted")
	}
}
