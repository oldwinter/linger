package composio

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Polling reads for Routine listeners. Every source is fetched incrementally
// through the managed-auth proxy; the caller owns the cursor semantics.

// Slack: conversations.history with `oldest` is the incremental read. The
// cursor is the newest message ts seen.
type SlackMessage struct {
	User     string
	Text     string
	Ts       string
	ThreadTs string
}

type SlackMessagePage struct {
	Messages   []SlackMessage
	NextCursor string
	Newest     string
}

func (c *Client) ListSlackChannelMessagesPage(ctx context.Context, connectedAccountID, channelID, oldest, pageCursor string, limit int) (SlackMessagePage, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	parameters := []proxyParameter{
		{Name: "channel", Value: channelID, Type: "query"},
		{Name: "limit", Value: strconv.Itoa(limit), Type: "query"},
	}
	if oldest != "" {
		parameters = append(parameters, proxyParameter{Name: "oldest", Value: oldest, Type: "query"})
	}
	if pageCursor != "" {
		parameters = append(parameters, proxyParameter{Name: "cursor", Value: pageCursor, Type: "query"})
	}
	var wire struct {
		slackResponse
		HasMore  bool `json:"has_more"`
		Messages []struct {
			Ts       string `json:"ts"`
			ThreadTs string `json:"thread_ts"`
			User     string `json:"user"`
			Text     string `json:"text"`
			Subtype  string `json:"subtype"`
		} `json:"messages"`
	}
	if err := c.slackProxy(ctx, connectedAccountID, "/conversations.history", parameters, &wire, "list Slack channel messages"); err != nil {
		return SlackMessagePage{}, err
	}
	if wire.HasMore && wire.ResponseMetadata.NextCursor == "" {
		return SlackMessagePage{}, errors.New("Slack history returned an incomplete page without a cursor")
	}
	page := SlackMessagePage{NextCursor: wire.ResponseMetadata.NextCursor}
	out := make([]SlackMessage, 0, len(wire.Messages))
	for _, m := range wire.Messages {
		if m.Ts > page.Newest {
			page.Newest = m.Ts
		}
		switch m.Subtype {
		case "", "thread_broadcast", "bot_message", "file_share", "me_message":
		default:
			continue // join/leave/topic noise is not message content
		}
		out = append(out, SlackMessage{User: m.User, Text: m.Text, Ts: m.Ts, ThreadTs: m.ThreadTs})
	}
	page.Messages = out
	return page, nil
}

// Slack channels the connection can see; a listener reads all of them.
type SlackChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (c *Client) ListSlackChannels(ctx context.Context, connectedAccountID string) ([]SlackChannel, error) {
	var channels []SlackChannel
	cursor := ""
	for {
		parameters := []proxyParameter{
			{Name: "limit", Value: "200", Type: "query"},
			{Name: "types", Value: "public_channel,private_channel,im", Type: "query"},
			{Name: "exclude_archived", Value: "true", Type: "query"},
		}
		if cursor != "" {
			parameters = append(parameters, proxyParameter{Name: "cursor", Value: cursor, Type: "query"})
		}
		var wire struct {
			slackResponse
			Channels []SlackChannel `json:"channels"`
		}
		if err := c.slackProxy(ctx, connectedAccountID, "/conversations.list", parameters, &wire, "list Slack channels"); err != nil {
			return nil, err
		}
		channels = append(channels, wire.Channels...)
		cursor = wire.ResponseMetadata.NextCursor
		if cursor == "" {
			return channels, nil
		}
	}
}

// Gmail: users.history gives message ids added after startHistoryId; each id
// is hydrated with messages.get for headers, labels and the message body. Cursor = profile
// historyId.
type GmailNewMessage struct {
	To       string
	ID       string
	ThreadID string
	From     string
	Subject  string
	Snippet  string
	LabelIDs []string
}

var ErrGmailPageTokenInvalid = errors.New("Gmail page token invalid")

type GmailMessagePage struct {
	Messages      []GmailNewMessage
	NextPageToken string
	HistoryID     string
}

// ListGmailNewMessagesPage reads one page; the caller persists its continuation
// with the delivered events and advances HistoryID only after the last page.
func (c *Client) ListGmailNewMessagesPage(ctx context.Context, connectedAccountID, startHistoryID, pageToken string) (GmailMessagePage, error) {
	parameters := []proxyParameter{
		{Name: "startHistoryId", Value: startHistoryID, Type: "query"},
		{Name: "historyTypes", Value: "messageAdded", Type: "query"},
		{Name: "maxResults", Value: "50", Type: "query"},
	}
	if pageToken != "" {
		parameters = append(parameters, proxyParameter{Name: "pageToken", Value: pageToken, Type: "query"})
	}
	var wire struct {
		History []struct {
			MessagesAdded []struct {
				Message struct {
					ID string `json:"id"`
				} `json:"message"`
			} `json:"messagesAdded"`
		} `json:"history"`
		HistoryID     string `json:"historyId"`
		NextPageToken string `json:"nextPageToken"`
	}
	err := c.proxy(ctx, proxyRequest{ConnectedAccountID: connectedAccountID,
		Endpoint: "/gmail/v1/users/me/history", Method: http.MethodGet, Parameters: parameters}, &wire, "list Gmail history")
	if err != nil {
		var remote *remoteError
		if errors.As(err, &remote) {
			if remote.status == http.StatusNotFound {
				return GmailMessagePage{}, ErrGmailHistoryExpired
			}
			if remote.status == http.StatusBadRequest && pageToken != "" {
				return GmailMessagePage{}, ErrGmailPageTokenInvalid
			}
		}
		return GmailMessagePage{}, err
	}
	if wire.HistoryID == "" || (pageToken != "" && wire.NextPageToken == pageToken) {
		return GmailMessagePage{}, errors.New("Gmail history returned an invalid continuation")
	}
	var messageIDs []string
	seen := map[string]bool{}
	for _, history := range wire.History {
		for _, item := range history.MessagesAdded {
			if item.Message.ID != "" && !seen[item.Message.ID] {
				seen[item.Message.ID] = true
				messageIDs = append(messageIDs, item.Message.ID)
			}
		}
	}
	var out []GmailNewMessage
	for _, id := range messageIDs {
		var message gmailMessage
		request := proxyRequest{
			ConnectedAccountID: connectedAccountID,
			Endpoint:           "/gmail/v1/users/me/messages/" + url.PathEscape(id),
			Method:             http.MethodGet,
			Parameters:         []proxyParameter{{Name: "format", Value: "full", Type: "query"}},
		}
		err := c.proxy(ctx, request, &message, "get Gmail message")
		oversized := errors.Is(err, ErrResponseTooLarge)
		if oversized {
			// A large immutable body must not stall every later message in this page.
			message = gmailMessage{}
			request.Parameters = []proxyParameter{
				{Name: "format", Value: "metadata", Type: "query"},
				{Name: "metadataHeaders", Value: "From", Type: "query"},
				{Name: "metadataHeaders", Value: "To", Type: "query"},
				{Name: "metadataHeaders", Value: "Subject", Type: "query"},
			}
			err = c.proxy(ctx, request, &message, "get oversized Gmail message headers")
		}
		if err != nil {
			var remote *remoteError
			if errors.As(err, &remote) && remote.status == http.StatusNotFound {
				continue // History can outlive a message deleted before this read.
			}
			return GmailMessagePage{}, err
		}
		bodyOversized, err := c.hydrateGmailPollBody(ctx, connectedAccountID, id, &message.Payload)
		if err != nil {
			return GmailMessagePage{}, err
		}
		body, truncated, err := preferredBody(message.Payload, c.maxThreadBytes+c.maxBodyBytes+1<<20)
		if err != nil {
			return GmailMessagePage{}, err
		}
		if oversized || (bodyOversized && strings.TrimSpace(body) == "") {
			body = oversizedMailBody
		} else {
			truncated = truncated || bodyOversized
		}
		out = append(out, GmailNewMessage{
			ID: message.ID, ThreadID: message.ThreadID,
			From: header(message.Payload, "From"), To: header(message.Payload, "To"),
			Subject: header(message.Payload, "Subject"), Snippet: pollMailBody(body, truncated),
			LabelIDs: message.LabelIDs,
		})
	}
	return GmailMessagePage{Messages: out, NextPageToken: wire.NextPageToken, HistoryID: wire.HistoryID}, nil
}

// BootstrapGmailHistoryID returns the mailbox's current historyId so a new
// listener starts from now instead of replaying history.
func (c *Client) BootstrapGmailHistoryID(ctx context.Context, connectedAccountID string) (string, error) {
	identity, err := c.IdentifyGmail(ctx, connectedAccountID)
	if err != nil {
		return "", err
	}
	return identity.HistoryID, nil
}

// Outlook: /me/messages/delta carries a deltaToken cursor in @odata.deltaLink.
// The endpoint value is a full provider URL when continuing a delta chain.
// It lists message identity and headers; the poller reads each new message body
// separately so existing provider delta tokens retain their query semantics.
type OutlookMessage struct {
	ID             string
	Subject        string
	From           string
	To             string
	CreatedAt      time.Time
	ReceivedAt     time.Time
	WebLink        string
	ParentFolderID string
	IsRead         bool
}

var ErrOutlookDeltaExpired = errors.New("Outlook delta token expired")

// The endpoint value is a full provider URL when continuing a delta chain.
// Returns (messages, nextLink, deltaLink): a non-empty nextLink means the
// chain has more pages; deltaLink is the terminal cursor.
func (c *Client) ListOutlookMessageDelta(ctx context.Context, connectedAccountID, deltaLink string) ([]OutlookMessage, string, string, error) {
	request, err := graphPollRequest(connectedAccountID, deltaLink)
	if err != nil {
		return nil, "", "", err
	}
	if deltaLink == "" {
		request.Endpoint = "/v1.0/me/mailFolders/inbox/messages/delta"
		request.Parameters = []proxyParameter{
			{Name: "$top", Value: "50", Type: "query"},
			{Name: "$select", Value: outlookDeltaFields, Type: "query"},
		}
	}

	var wire struct {
		Value []struct {
			ID               string             `json:"id"`
			Subject          string             `json:"subject"`
			WebLink          string             `json:"webLink"`
			IsRead           bool               `json:"isRead"`
			ParentFolderID   string             `json:"parentFolderId"`
			CreatedDateTime  string             `json:"createdDateTime"`
			ReceivedDateTime string             `json:"receivedDateTime"`
			From             outlookRecipient   `json:"from"`
			ToRecipients     []outlookRecipient `json:"toRecipients"`
		} `json:"value"`
		NextLink  string `json:"@odata.nextLink"`
		DeltaLink string `json:"@odata.deltaLink"`
	}
	if err := c.proxy(ctx, request, &wire, "list Outlook message delta"); err != nil {
		var remote *remoteError
		if errors.As(err, &remote) && remote.status == http.StatusGone {
			return nil, "", "", ErrOutlookDeltaExpired
		}
		return nil, "", "", err
	}
	if (wire.NextLink == "") == (wire.DeltaLink == "") || (wire.NextLink != "" && wire.NextLink == deltaLink) {
		return nil, "", "", errors.New("Outlook delta returned an invalid continuation")
	}
	out := make([]OutlookMessage, 0, len(wire.Value))
	for _, m := range wire.Value {
		created, _ := time.Parse(time.RFC3339Nano, m.CreatedDateTime)
		received, _ := time.Parse(time.RFC3339Nano, m.ReceivedDateTime)
		to := make([]string, 0, len(m.ToRecipients))
		for _, recipient := range m.ToRecipients {
			to = append(to, recipient.String())
		}
		out = append(out, OutlookMessage{
			ID: m.ID, Subject: m.Subject, WebLink: m.WebLink, IsRead: m.IsRead,
			ParentFolderID: m.ParentFolderID, CreatedAt: created, ReceivedAt: received,
			From: m.From.String(), To: strings.Join(to, ", "),
		})
	}
	return out, wire.NextLink, wire.DeltaLink, nil
}

const outlookDeltaFields = "subject,from,toRecipients,webLink,isRead,parentFolderId,createdDateTime,receivedDateTime"

const outlookCalendarPreferHeader = `odata.maxpagesize=50, outlook.timezone="UTC"`

// OutlookCalendarChange is one event entry returned by Microsoft Graph
// calendarView/delta. Deleted or out-of-window entries set Removed with
// RemovedReason ("deleted" or "changed") and carry no event fields beyond ID.
type OutlookCalendarChange struct {
	ID            string
	Subject       string
	Removed       bool
	RemovedReason string
	IsCancelled   bool
	IsAllDay      bool
	CreatedAt     time.Time
	LastModified  time.Time
	Start         string
	End           string
	Organizer     string
	Description   string
	Location      string
}

// ListOutlookCalendarDelta reads one page of Microsoft Graph calendarView/delta.
// On the first call (deltaLink empty), start and end define the bounded view
// window baked into Graph's continuation tokens; subsequent calls follow the
// returned nextLink or deltaLink without re-sending query parameters.
func (c *Client) ListOutlookCalendarDelta(ctx context.Context, connectedAccountID, calendarID string, start, end time.Time, deltaLink string) ([]OutlookCalendarChange, string, string, error) {
	request, err := graphPollRequest(connectedAccountID, deltaLink)
	if err != nil {
		return nil, "", "", err
	}
	if deltaLink == "" {
		if calendarID == "" || calendarID == "primary" {
			request.Endpoint = "/v1.0/me/calendarView/delta"
		} else {
			request.Endpoint = "/v1.0/me/calendars/" + url.PathEscape(calendarID) + "/calendarView/delta"
		}
		request.Parameters = []proxyParameter{
			{Name: "startDateTime", Value: start.UTC().Format(time.RFC3339), Type: "query"},
			{Name: "endDateTime", Value: end.UTC().Format(time.RFC3339), Type: "query"},
		}
	}
	request.Parameters = append(request.Parameters, proxyParameter{
		Name: "Prefer", Value: outlookCalendarPreferHeader, Type: "header",
	})

	var wire struct {
		Value []struct {
			ID                   string `json:"id"`
			Subject              string `json:"subject"`
			IsAllDay             bool   `json:"isAllDay"`
			IsCancelled          bool   `json:"isCancelled"`
			CreatedDateTime      string `json:"createdDateTime"`
			LastModifiedDateTime string `json:"lastModifiedDateTime"`
			Start                struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"start"`
			End struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"end"`
			Location struct {
				DisplayName string `json:"displayName"`
			} `json:"location"`
			Organizer outlookRecipient `json:"organizer"`
			Body      struct {
				ContentType string `json:"contentType"`
				Content     string `json:"content"`
			} `json:"body"`
			BodyPreview string `json:"bodyPreview"`
			Removed     *struct {
				Reason string `json:"reason"`
			} `json:"@removed"`
		} `json:"value"`
		NextLink  string `json:"@odata.nextLink"`
		DeltaLink string `json:"@odata.deltaLink"`
	}
	if err := c.proxy(ctx, request, &wire, "list Outlook calendar delta"); err != nil {
		var remote *remoteError
		if errors.As(err, &remote) && remote.status == http.StatusGone {
			return nil, "", "", ErrOutlookDeltaExpired
		}
		return nil, "", "", err
	}
	if (wire.NextLink == "") == (wire.DeltaLink == "") || (wire.NextLink != "" && wire.NextLink == deltaLink) {
		return nil, "", "", errors.New("Outlook calendar delta returned an invalid continuation")
	}
	out := make([]OutlookCalendarChange, 0, len(wire.Value))
	for _, item := range wire.Value {
		change := OutlookCalendarChange{
			ID:          item.ID,
			Subject:     item.Subject,
			IsCancelled: item.IsCancelled,
			IsAllDay:    item.IsAllDay,
			Start:       outlookCalendarTime(item.Start.DateTime, item.Start.TimeZone, item.IsAllDay),
			End:         outlookCalendarTime(item.End.DateTime, item.End.TimeZone, item.IsAllDay),
			Organizer:   item.Organizer.String(),
			Location:    strings.TrimSpace(item.Location.DisplayName),
		}
		if item.Removed != nil {
			change.Removed = true
			change.RemovedReason = strings.TrimSpace(item.Removed.Reason)
		}
		if t, err := time.Parse(time.RFC3339Nano, item.CreatedDateTime); err == nil {
			change.CreatedAt = t
		}
		if t, err := time.Parse(time.RFC3339Nano, item.LastModifiedDateTime); err == nil {
			change.LastModified = t
		}
		description := item.Body.Content
		if strings.EqualFold(item.Body.ContentType, "html") {
			description = htmlText(description)
		}
		change.Description = pollTextBody(description, false)
		if change.Description == "" {
			change.Description = pollTextBody(item.BodyPreview, false)
		}
		out = append(out, change)
	}
	return out, wire.NextLink, wire.DeltaLink, nil
}

// outlookCalendarTime normalizes Graph's naive dateTimeTimeZone into an RFC3339
// instant (or YYYY-MM-DD for all-day events) so downstream callers parse it
// uniformly alongside Google Calendar timestamps.
func outlookCalendarTime(dateTime, timeZone string, allDay bool) string {
	raw := strings.TrimSpace(dateTime)
	if raw == "" {
		return ""
	}
	if allDay && len(raw) >= len(time.DateOnly) {
		if _, err := time.Parse(time.DateOnly, raw[:len(time.DateOnly)]); err == nil {
			return raw[:len(time.DateOnly)]
		}
	}
	if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return parsed.UTC().Format(time.RFC3339)
	}
	tz := strings.TrimSpace(timeZone)
	if tz == "" || strings.EqualFold(tz, "UTC") {
		if parsed, err := time.Parse("2006-01-02T15:04:05.9999999", raw); err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	} else if loc, err := time.LoadLocation(tz); err == nil {
		if parsed, err := time.ParseInLocation("2006-01-02T15:04:05.9999999", raw, loc); err == nil {
			return parsed.Format(time.RFC3339)
		}
	}
	return raw
}

type outlookRecipient struct {
	EmailAddress struct {
		Address string `json:"address"`
		Name    string `json:"name"`
	} `json:"emailAddress"`
}

// String is the recipient as a mail header writes it: "Name <address>", or
// the address alone without a name.
func (r outlookRecipient) String() string {
	name, address := strings.TrimSpace(r.EmailAddress.Name), strings.TrimSpace(r.EmailAddress.Address)
	switch {
	case name == "" || name == address:
		return address
	case address == "":
		return name
	}
	return name + " <" + address + ">"
}

// Google Calendar: events.list with updatedMin + showDeleted yields every
// change since the cursor; status=cancelled marks deletions.
var ErrCalendarPageTokenInvalid = errors.New("Google Calendar page token invalid")

type GoogleCalendarChange struct {
	ID          string
	Summary     string
	Status      string // confirmed|cancelled
	Updated     time.Time
	Created     time.Time
	Start       string
	End         string
	Organizer   string
	Description string
	Location    string
}

func (c *Client) ListGoogleCalendarChanges(ctx context.Context, connectedAccountID, calendarID string, updatedMin time.Time, pageToken string) ([]GoogleCalendarChange, string, error) {
	parameters := []proxyParameter{
		{Name: "maxResults", Value: "50", Type: "query"},
		{Name: "singleEvents", Value: "true", Type: "query"},
		{Name: "showDeleted", Value: "true", Type: "query"},
	}
	if !updatedMin.IsZero() {
		parameters = append(parameters, proxyParameter{Name: "updatedMin", Value: updatedMin.UTC().Format(time.RFC3339), Type: "query"})
	}
	if pageToken != "" {
		parameters = append(parameters, proxyParameter{Name: "pageToken", Value: pageToken, Type: "query"})
	}
	var wire googleCalendarEventsWire
	endpoint := "/calendars/" + url.PathEscape(calendarID) + "/events"
	if err := c.proxy(ctx, proxyRequest{ConnectedAccountID: connectedAccountID, Endpoint: endpoint, Method: http.MethodGet, Parameters: parameters}, &wire, "list Google Calendar changes"); err != nil {
		var remote *remoteError
		if pageToken != "" && errors.As(err, &remote) && remote.status == http.StatusBadRequest {
			return nil, "", ErrCalendarPageTokenInvalid
		}
		return nil, "", err
	}
	if pageToken != "" && pageToken == wire.NextPageToken {
		return nil, "", errors.New("Google Calendar returned a repeated page token")
	}
	out := make([]GoogleCalendarChange, 0, len(wire.Items))
	for _, item := range wire.Items {
		change := GoogleCalendarChange{ID: item.ID, Summary: item.Summary, Status: item.Status}
		if t, err := time.Parse(time.RFC3339Nano, item.Updated); err == nil {
			change.Updated = t
		}
		if t, err := time.Parse(time.RFC3339Nano, item.Created); err == nil {
			change.Created = t
		}
		change.Start = item.Start.DateTime
		if change.Start == "" {
			change.Start = item.Start.Date
		}
		change.End = item.End.DateTime
		if change.End == "" {
			change.End = item.End.Date
		}
		change.Organizer = item.Organizer.Email
		change.Description = pollTextBody(htmlText(item.Description), false)
		change.Location = item.Location
		out = append(out, change)
	}
	return out, wire.NextPageToken, nil
}

// Proxy continuations retain Graph's opaque query and never select another host.
func graphPollRequest(accountID, link string) (proxyRequest, error) {
	parsed, err := url.Parse(link)
	if err != nil || (parsed.Host != "" && (parsed.Scheme != "https" || parsed.Host != "graph.microsoft.com")) {
		return proxyRequest{}, errors.New("invalid Graph continuation")
	}
	request := proxyRequest{ConnectedAccountID: accountID, Endpoint: parsed.EscapedPath(), Method: "GET"}
	for key, values := range parsed.Query() {
		for _, value := range values {
			request.Parameters = append(request.Parameters, proxyParameter{Name: key, Value: value, Type: "query"})
		}
	}
	return request, nil
}
