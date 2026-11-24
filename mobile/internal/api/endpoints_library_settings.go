package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// --- Library, Documents, Personal Wiki, Profile, Memory & Search ---

func (c *Client) ListLibraryDocuments(ctx context.Context, limit int, cursor string) (DocumentPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out DocumentPage
	err := c.DoJSON(ctx, http.MethodGet, "/v0/library/documents"+BuildQuery(q), nil, &out)
	return out, err
}

func (c *Client) SearchLibraryDocuments(ctx context.Context, query string, limit int) (DocumentPage, error) {
	q := url.Values{}
	q.Set("q", query)
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var out DocumentPage
	err := c.DoJSON(ctx, http.MethodGet, "/v0/library/documents/search"+BuildQuery(q), nil, &out)
	return out, err
}

func (c *Client) GetMyDocumentTree(ctx context.Context, tenantID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/document-tree", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) GetMySharedDocumentTree(ctx context.Context, tenantID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/shared-document-tree", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) GetDocument(ctx context.Context, docID string) (Document, error) {
	var out Document
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s", url.PathEscape(docID)), nil, &out)
	return out, err
}

func (c *Client) ListDocumentVersions(ctx context.Context, docID string) ([]DocumentVersion, error) {
	var out DocumentVersionList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/versions", url.PathEscape(docID)), nil, &out)
	return out.Items, err
}

func (c *Client) DownloadLatestDocument(ctx context.Context, docID string) ([]byte, string, error) {
	return c.DoBytes(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/downloads", url.PathEscape(docID)), nil, nil)
}

func (c *Client) DownloadDocumentVersion(ctx context.Context, versionID string) ([]byte, string, error) {
	return c.DoBytes(ctx, http.MethodGet, fmt.Sprintf("/v0/document-versions/%s/content", url.PathEscape(versionID)), nil, nil)
}

func (c *Client) ListDocumentCommentThreads(ctx context.Context, docID string) ([]DocumentCommentThread, error) {
	var out DocumentCommentThreadList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/comment-threads", url.PathEscape(docID)), nil, &out)
	return out.Items, err
}

func (c *Client) CreateDocumentCommentReply(ctx context.Context, threadID, body string) (DocumentComment, error) {
	var out DocumentComment
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/document-comment-threads/%s/comments", url.PathEscape(threadID)), map[string]string{
		"body": body,
	}, &out)
	return out, err
}

func (c *Client) GetPersonalWiki(ctx context.Context, tenantID string) (PersonalWiki, error) {
	var out PersonalWiki
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-wiki", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) RefreshPersonalWiki(ctx context.Context, tenantID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/personal-wiki/refresh", url.PathEscape(tenantID)), struct{}{}, &out)
	return out, err
}

func (c *Client) ListPersonalWikiDocuments(ctx context.Context, tenantID string) (DocumentPage, error) {
	var out DocumentPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-wiki/documents", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) GetPersonalWikiGraph(ctx context.Context, tenantID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-wiki/graph", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) GetPersonalProfile(ctx context.Context, tenantID string) (PersonalProfile, error) {
	var out PersonalProfile
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-profile", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) ListPersonalMemory(ctx context.Context, tenantID string, limit int, cursor string) (PersonalMemoryPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out PersonalMemoryPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/memory%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

func (c *Client) ListPersonalInsights(ctx context.Context, tenantID string) ([]PersonalInsight, error) {
	var out PersonalInsightList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-insights", url.PathEscape(tenantID)), nil, &out)
	return out.Items, err
}

func (c *Client) DeletePersonalInsight(ctx context.Context, tenantID, insightID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/personal-insights/%s", url.PathEscape(tenantID), url.PathEscape(insightID)), nil, nil)
}

func (c *Client) SearchTenantMessages(ctx context.Context, tenantID, query string, limit int) (MessageSearchPage, error) {
	q := url.Values{}
	q.Set("q", query)
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var out MessageSearchPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/messages/search%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// --- Voice, External Apps, Web Search & Account Profile ---

func (c *Client) GetVoiceMediaPolicy(ctx context.Context, tenantID string) (VoiceMediaPolicy, error) {
	var out VoiceMediaPolicy
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/voice-media-policy", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) SaveVoiceProviderKey(ctx context.Context, provider, apiKey string) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/voice-provider-keys/%s", url.PathEscape(provider)), map[string]string{
		"api_key": apiKey,
	}, nil)
}

func (c *Client) GetActiveVoiceSession(ctx context.Context, roomID string) (VoiceSession, error) {
	var out VoiceSession
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/voice-sessions", url.PathEscape(roomID)), nil, &out)
	return out, err
}

func (c *Client) GetActiveVoiceCapture(ctx context.Context, roomID string) (VoiceCapture, error) {
	var out VoiceCapture
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/active-voice-capture", url.PathEscape(roomID)), nil, &out)
	return out, err
}

func (c *Client) GetVoiceCapture(ctx context.Context, captureID string) (VoiceCapture, error) {
	var out VoiceCapture
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/voice-captures/%s", url.PathEscape(captureID)), nil, &out)
	return out, err
}

func (c *Client) StopVoiceCapture(ctx context.Context, captureID string) (VoiceCapture, error) {
	var out VoiceCapture
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-captures/%s/stop", url.PathEscape(captureID)), struct{}{}, &out)
	return out, err
}

func (c *Client) RetryVoiceCaptureTranscript(ctx context.Context, captureID string) (VoiceCapture, error) {
	var out VoiceCapture
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-captures/%s/transcript-recovery/retry", url.PathEscape(captureID)), struct{}{}, &out)
	return out, err
}

func (c *Client) ListVoiceCaptureQuestions(ctx context.Context, captureID string) ([]VoiceCaptureQuestion, error) {
	var out VoiceCaptureQuestionList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/voice-captures/%s/questions", url.PathEscape(captureID)), nil, &out)
	return out.Items, err
}

func (c *Client) AskVoiceCaptureQuestion(ctx context.Context, captureID, question string) (VoiceCaptureQuestion, error) {
	var out VoiceCaptureQuestion
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-captures/%s/questions", url.PathEscape(captureID)), map[string]string{
		"question": question,
	}, &out)
	return out, err
}

func (c *Client) SendVoiceCaptureQuestionTask(ctx context.Context, captureID, questionID string) (VoiceCaptureQuestion, error) {
	var out VoiceCaptureQuestion
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-captures/%s/questions/%s/task", url.PathEscape(captureID), url.PathEscape(questionID)), struct{}{}, &out)
	return out, err
}

func (c *Client) ListVoiceTranscriptEvents(ctx context.Context, sessionID string) (VoiceTranscriptEventPage, error) {
	var out VoiceTranscriptEventPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/voice-sessions/%s/transcript-events", url.PathEscape(sessionID)), nil, &out)
	return out, err
}

func (c *Client) ListExternalApps(ctx context.Context) (ExternalAppList, error) {
	var out ExternalAppList
	err := c.DoJSON(ctx, http.MethodGet, "/v0/external-apps", nil, &out)
	return out, err
}

func (c *Client) SaveExternalProviderKey(ctx context.Context, apiKey string) error {
	return c.DoJSON(ctx, http.MethodPut, "/v0/external-apps/provider-key", map[string]string{
		"api_key": apiKey,
	}, nil)
}

func (c *Client) ListExternalConnections(ctx context.Context) ([]ExternalConnection, error) {
	var out ExternalConnectionList
	err := c.DoJSON(ctx, http.MethodGet, "/v0/external-connections", nil, &out)
	return out.Connections, err
}

func (c *Client) CreateExternalConnection(ctx context.Context, provider string) (ExternalConnection, error) {
	var out ExternalConnection
	err := c.DoJSON(ctx, http.MethodPost, "/v0/external-connections", map[string]string{
		"provider": provider,
	}, &out)
	return out, err
}

func (c *Client) DisconnectExternalConnection(ctx context.Context, connID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/external-connections/%s/disconnects", url.PathEscape(connID)), struct{}{}, nil)
}

func (c *Client) SetExternalConnectionAutoReminders(ctx context.Context, connID string, enabled bool) (ExternalConnection, error) {
	var out ExternalConnection
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/external-connections/%s/auto-reminders", url.PathEscape(connID)), map[string]bool{
		"auto_reminders": enabled,
	}, &out)
	return out, err
}

func (c *Client) ListWebSearchBackends(ctx context.Context) (WebSearchBackendList, error) {
	var out WebSearchBackendList
	err := c.DoJSON(ctx, http.MethodGet, "/v0/web-search/backends", nil, &out)
	return out, err
}

func (c *Client) SaveWebSearchKey(ctx context.Context, backend, apiKey string) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/web-search/backends/%s/key", url.PathEscape(backend)), map[string]string{
		"api_key": apiKey,
	}, nil)
}

func (c *Client) DeleteWebSearchKey(ctx context.Context, backend string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/web-search/backends/%s/key", url.PathEscape(backend)), nil, nil)
}

func (c *Client) SetWebSearchDefault(ctx context.Context, backend string) error {
	return c.DoJSON(ctx, http.MethodPut, "/v0/web-search/default", map[string]string{
		"backend": backend,
	}, nil)
}

func (c *Client) GetAccountProfile(ctx context.Context, tenantID string) (AccountProfile, error) {
	var out AccountProfile
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/account-profile", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) PatchAccountProfile(ctx context.Context, tenantID string, patch AccountProfilePatch) (AccountProfile, error) {
	var out AccountProfile
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/tenants/%s/account-profile", url.PathEscape(tenantID)), patch, &out)
	return out, err
}
