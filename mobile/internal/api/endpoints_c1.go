package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

// --- Room Participation, Attachments, Team.md, History Shares & Mail Canvas ---

// SetRoomParticipation switches personal participation ("joined" or "left") on ordinary Rooms.
func (c *Client) SetRoomParticipation(ctx context.Context, roomID, status string) (Room, error) {
	var out Room
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/participation", url.PathEscape(roomID)), map[string]string{
		"status": status,
	}, &out)
	return out, err
}

// GetMessage fetches GET /v0/rooms/:roomId/messages/:messageId.
func (c *Client) GetMessage(ctx context.Context, roomID, messageID string) (Message, error) {
	var out Message
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/messages/%s", url.PathEscape(roomID), url.PathEscape(messageID)), nil, &out)
	return out, err
}

// GetMessageActivities fetches GET /v0/rooms/:roomId/messages/:messageId/activities.
func (c *Client) GetMessageActivities(ctx context.Context, roomID, messageID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/messages/%s/activities", url.PathEscape(roomID), url.PathEscape(messageID)), nil, &out)
	return out, err
}

// GetRunActivities fetches GET /v0/rooms/:roomId/runs/:runId/activities.
func (c *Client) GetRunActivities(ctx context.Context, roomID, runID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/runs/%s/activities", url.PathEscape(roomID), url.PathEscape(runID)), nil, &out)
	return out, err
}

// UploadMessageAttachment uploads a photo or file via multipart/form-data to
// POST /v0/rooms/:roomId/message-attachment-uploads with Idempotency-Key.
// Matches TeamHub's strict form schema: fields "filename" + "media_type", file "content".
func (c *Client) UploadMessageAttachment(ctx context.Context, roomID, filename, mediaType string, content []byte, idempotencyKey string) (MessageAttachmentUpload, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("filename", filename)
	if mediaType != "" {
		_ = mw.WriteField("media_type", mediaType)
	}
	part, err := mw.CreateFormFile("content", filename)
	if err != nil {
		return MessageAttachmentUpload{}, err
	}
	if _, err := part.Write(content); err != nil {
		return MessageAttachmentUpload{}, err
	}
	if err := mw.Close(); err != nil {
		return MessageAttachmentUpload{}, err
	}

	headers := map[string]string{
		"Content-Type":    mw.FormDataContentType(),
		"Idempotency-Key": idempotencyKey,
	}
	raw, _, err := c.DoBytes(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/message-attachment-uploads", url.PathEscape(roomID)), &buf, headers)
	if err != nil {
		return MessageAttachmentUpload{}, err
	}
	var out MessageAttachmentUpload
	if err := json.Unmarshal(raw, &out); err != nil {
		return MessageAttachmentUpload{}, fmt.Errorf("api: decode attachment upload: %w", err)
	}
	return out, nil
}

// CancelMessageAttachmentUpload removes a pending upload via DELETE /v0/rooms/:roomId/message-attachment-uploads/:uploadId.
func (c *Client) CancelMessageAttachmentUpload(ctx context.Context, roomID, uploadID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s/message-attachment-uploads/%s", url.PathEscape(roomID), url.PathEscape(uploadID)), nil, nil)
}

// GetRoomTeamMd fetches GET /v0/rooms/:roomId/team-md.
func (c *Client) GetRoomTeamMd(ctx context.Context, roomID string) (TeamMdDocument, error) {
	var out TeamMdDocument
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/team-md", url.PathEscape(roomID)), nil, &out)
	return out, err
}

// ListRoomHistoryShares fetches GET /v0/rooms/:roomId/history-shares.
func (c *Client) ListRoomHistoryShares(ctx context.Context, roomID string) ([]RoomHistoryShare, error) {
	var out RoomHistorySharePage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/history-shares", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

// CreateRoomHistoryShare creates a share via POST /v0/rooms/:roomId/history-shares/create.
func (c *Client) CreateRoomHistoryShare(ctx context.Context, roomID, webVersion string) (RoomHistoryShare, error) {
	body := map[string]string{}
	if webVersion != "" {
		body["web_version"] = webVersion
	}
	var out RoomHistoryShare
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/history-shares/create", url.PathEscape(roomID)), body, &out)
	return out, err
}

// RevokeRoomHistoryShare revokes a share via DELETE /v0/rooms/:roomId/history-shares/:shareId.
func (c *Client) RevokeRoomHistoryShare(ctx context.Context, roomID, shareID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s/history-shares/%s", url.PathEscape(roomID), url.PathEscape(shareID)), nil, nil)
}

// GetMailCanvas fetches GET /v0/documents/:documentId/mail.
func (c *Client) GetMailCanvas(ctx context.Context, documentID string) (MailCanvasState, error) {
	var out MailCanvasState
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/mail", url.PathEscape(documentID)), nil, &out)
	return out, err
}

// SendMailCanvas sends or resends a Mail Canvas via POST /v0/documents/:documentId/mail.
func (c *Client) SendMailCanvas(ctx context.Context, documentID string, req SendMailCanvasRequest) (MailCanvasState, error) {
	var out MailCanvasState
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/documents/%s/mail", url.PathEscape(documentID)), req, &out)
	return out, err
}

// DeclineMailCanvas declines a Mail Canvas via POST /v0/documents/:documentId/mail/decline.
func (c *Client) DeclineMailCanvas(ctx context.Context, documentID string) (MailCanvasState, error) {
	var out MailCanvasState
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/documents/%s/mail/decline", url.PathEscape(documentID)), struct{}{}, &out)
	return out, err
}

// --- Agent Availability, Computers, Permissions, Browser Connection, Models & BYOK ---

// ListTenantAgentAvailability fetches GET /v0/tenants/:tenantId/agent-availability.
func (c *Client) ListTenantAgentAvailability(ctx context.Context, tenantID string) ([]TenantAgentAvailabilitySnapshot, error) {
	var out TenantAgentAvailabilityPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/agent-availability", url.PathEscape(tenantID)), nil, &out)
	return out.Items, err
}

// RemoveLocalComputer removes an enrolled computer via DELETE /v0/tenants/:tenantId/local-computers/:computerId.
func (c *Client) RemoveLocalComputer(ctx context.Context, tenantID, computerID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/local-computers/%s", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, nil)
}

// ActOnLocalComputerModelWithUnload executes a model action (including load with unload_first for Make Room & Load).
func (c *Client) ActOnLocalComputerModelWithUnload(ctx context.Context, tenantID, computerID, modelID, action string, unloadFirst []string) error {
	body := map[string]any{"action": action}
	if len(unloadFirst) > 0 {
		body["unload_first"] = unloadFirst
	}
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/local-models/%s/actions", url.PathEscape(tenantID), url.PathEscape(computerID), url.PathEscape(modelID)), body, nil)
}

// GetLocalComputerPermissionsTyped returns strongly typed macOS/host permissions status.
func (c *Client) GetLocalComputerPermissionsTyped(ctx context.Context, tenantID, computerID string) (ComputerPermissionStatus, error) {
	var out ComputerPermissionStatus
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/permissions", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

// ActOnLocalComputerPermissionTyped triggers prompt/open_settings/relaunch on a Local Computer permission.
func (c *Client) ActOnLocalComputerPermissionTyped(ctx context.Context, tenantID, computerID, subject, permission, action string) (ComputerPermissionStatus, error) {
	body := map[string]any{
		"subject": subject,
		"action":  action,
	}
	if permission != "" {
		body["permission"] = permission
	}
	var out ComputerPermissionStatus
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/permissions", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

// GetLocalComputerBrowserConnectionTyped returns strongly typed browser connection state.
func (c *Client) GetLocalComputerBrowserConnectionTyped(ctx context.Context, tenantID, computerID string) (BrowserConnectionStatus, error) {
	var out BrowserConnectionStatus
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/browser-connection", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

// PutLocalComputerBrowserConnectionTyped connects or updates a Chrome browser profile on a Local Computer.
func (c *Client) PutLocalComputerBrowserConnectionTyped(ctx context.Context, tenantID, computerID, profile string) (BrowserConnectionStatus, error) {
	body := map[string]any{}
	if profile != "" {
		body["profile"] = profile
	}
	var out BrowserConnectionStatus
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/browser-connection", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

// TestLocalComputerModelSourceTyped tests a BYOK endpoint via POST .../model-source/test.
func (c *Client) TestLocalComputerModelSourceTyped(ctx context.Context, tenantID, computerID string, byok ByokInput) (ByokTestResult, error) {
	var out ByokTestResult
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source/test", url.PathEscape(tenantID), url.PathEscape(computerID)), map[string]any{
		"byok": byok,
	}, &out)
	return out, err
}

// ListLocalComputerByokModelsTyped lists models offered by a BYOK provider via POST .../model-source/models.
func (c *Client) ListLocalComputerByokModelsTyped(ctx context.Context, tenantID, computerID string, byok ByokInput) (ByokModelList, error) {
	var out ByokModelList
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source/models", url.PathEscape(tenantID), url.PathEscape(computerID)), map[string]any{
		"byok": byok,
	}, &out)
	return out, err
}

// ResolveEndpointURL resolves a relative TeamHub path (such as /v0/decisions/:id/screenshot)
// against the client's currently active BaseURL for use with ui/netimage.
func (c *Client) ResolveEndpointURL(path string) string {
	if path == "" {
		return ""
	}
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return c.BaseURL() + path
}
