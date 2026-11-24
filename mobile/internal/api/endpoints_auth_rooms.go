package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// --- Auth, Session, Identity & Tenants ---

// Login authenticates in Direct TeamHub mode via POST /v0/auth/login and captures the session cookie.
func (c *Client) Login(ctx context.Context, email, password string) (Session, error) {
	c.mu.Lock()
	c.mode = AuthModeDirect
	c.mu.Unlock()
	var out Session
	err := c.DoJSON(ctx, http.MethodPost, "/v0/auth/login", LoginRequest{
		Email:    email,
		Password: password,
	}, &out)
	return out, err
}

// GetSession fetches GET /v0/session.
func (c *Client) GetSession(ctx context.Context) (Session, error) {
	var out Session
	err := c.DoJSON(ctx, http.MethodGet, "/v0/session", nil, &out)
	return out, err
}

// RenewSession explicitly renews the active session via POST /v0/session.
func (c *Client) RenewSession(ctx context.Context) (Session, error) {
	var out Session
	err := c.DoJSON(ctx, http.MethodPost, "/v0/session", struct{}{}, &out)
	return out, err
}

// Logout terminates the session in Direct mode via POST /v0/auth/logout.
func (c *Client) Logout(ctx context.Context) error {
	err := c.DoJSON(ctx, http.MethodPost, "/v0/auth/logout", struct{}{}, nil)
	if err == nil {
		c.SetToken("")
	}
	return err
}

// GetMe fetches GET /v0/me.
func (c *Client) GetMe(ctx context.Context) (CurrentIdentity, error) {
	var out CurrentIdentity
	err := c.DoJSON(ctx, http.MethodGet, "/v0/me", nil, &out)
	return out, err
}

// ListTenants fetches GET /v0/tenants.
func (c *Client) ListTenants(ctx context.Context) ([]Tenant, error) {
	var out TenantList
	if err := c.DoJSON(ctx, http.MethodGet, "/v0/tenants", nil, &out); err != nil {
		return nil, err
	}
	return out.Items, nil
}

// ListActors fetches GET /v0/tenants/:tenantId/actors.
func (c *Client) ListActors(ctx context.Context, tenantID string, limit int, cursor string) (ActorPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out ActorPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/actors%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// GetAnotherMe fetches GET /v0/tenants/:tenantId/another-me.
func (c *Client) GetAnotherMe(ctx context.Context, tenantID string) (AnotherMeSummary, error) {
	var raw json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/another-me", url.PathEscape(tenantID)), nil, &raw)
	if err != nil {
		return AnotherMeSummary{}, err
	}
	var out AnotherMeSummary
	_ = json.Unmarshal(raw, &out)
	out.RawResponse = raw
	return out, nil
}

// --- Rooms, Messages, Threads, Pins, Reactions & Presence ---

// ListRooms fetches GET /v0/tenants/:tenantId/rooms.
func (c *Client) ListRooms(ctx context.Context, tenantID string, limit int, cursor string) (RoomListPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out RoomListPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/rooms%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// GetRoomActivity fetches GET /v0/tenants/:tenantId/room-activity.
func (c *Client) GetRoomActivity(ctx context.Context, tenantID string) (TenantRoomActivity, error) {
	var out TenantRoomActivity
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/room-activity", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// CreateRoom creates a group Room via POST /v0/tenants/:tenantId/rooms.
func (c *Client) CreateRoom(ctx context.Context, tenantID, name, description string, memberActorIDs []string) (Room, error) {
	body := map[string]any{"name": name}
	if description != "" {
		body["description"] = description
	}
	if len(memberActorIDs) > 0 {
		body["member_actor_ids"] = memberActorIDs
	}
	var out Room
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/rooms", url.PathEscape(tenantID)), body, &out)
	return out, err
}

// OpenDirectRoom opens or returns a direct Room via POST /v0/tenants/:tenantId/direct-rooms.
func (c *Client) OpenDirectRoom(ctx context.Context, tenantID, peerActorID string) (Room, error) {
	var out Room
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/direct-rooms", url.PathEscape(tenantID)), map[string]string{
		"peer_actor_id": peerActorID,
	}, &out)
	return out, err
}

// GetRoom fetches GET /v0/rooms/:roomId.
func (c *Client) GetRoom(ctx context.Context, roomID string) (Room, error) {
	var out Room
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s", url.PathEscape(roomID)), nil, &out)
	return out, err
}

// UpdateRoom patches Room name/description via PATCH /v0/rooms/:roomId.
func (c *Client) UpdateRoom(ctx context.Context, roomID string, name, description *string) (Room, error) {
	body := map[string]any{}
	if name != nil {
		body["name"] = *name
	}
	if description != nil {
		body["description"] = *description
	}
	var out Room
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/rooms/%s", url.PathEscape(roomID)), body, &out)
	return out, err
}

// DeleteRoom deletes a Room via DELETE /v0/rooms/:roomId.
func (c *Client) DeleteRoom(ctx context.Context, roomID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s", url.PathEscape(roomID)), nil, nil)
}

// ListRoomMembers fetches GET /v0/rooms/:roomId/members.
func (c *Client) ListRoomMembers(ctx context.Context, roomID string) (RoomMemberPage, error) {
	var out RoomMemberPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/members", url.PathEscape(roomID)), nil, &out)
	return out, err
}

// PutRoomMember adds or updates a member via PUT /v0/rooms/:roomId/members/:actorId.
func (c *Client) PutRoomMember(ctx context.Context, roomID, actorID, role string) (RoomMember, error) {
	if role == "" {
		role = "member"
	}
	var out RoomMember
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/members/%s", url.PathEscape(roomID), url.PathEscape(actorID)), map[string]string{
		"role": role,
	}, &out)
	return out, err
}

// DeleteRoomMember removes a member via DELETE /v0/rooms/:roomId/members/:actorId.
func (c *Client) DeleteRoomMember(ctx context.Context, roomID, actorID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s/members/%s", url.PathEscape(roomID), url.PathEscape(actorID)), nil, nil)
}

// ListMessages fetches GET /v0/rooms/:roomId/messages.
func (c *Client) ListMessages(ctx context.Context, roomID string, limit int, cursor string) (MessagePage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out MessagePage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/messages%s", url.PathEscape(roomID), BuildQuery(q)), nil, &out)
	return out, err
}

// CreateMessage sends a message via POST /v0/rooms/:roomId/messages with optional Idempotency-Key.
func (c *Client) CreateMessage(ctx context.Context, roomID string, req CreateMessageRequest, idempotencyKey string) (Message, error) {
	headers := map[string]string{}
	if idempotencyKey != "" {
		headers["Idempotency-Key"] = idempotencyKey
	}
	var out Message
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/messages", url.PathEscape(roomID)), req, headers, &out)
	return out, err
}

// CreateOrGetMessageThread opens or fetches a message's Thread via POST /v0/rooms/:roomId/messages/:messageId/thread.
func (c *Client) CreateOrGetMessageThread(ctx context.Context, roomID, messageID string) (Room, error) {
	var out Room
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/messages/%s/thread", url.PathEscape(roomID), url.PathEscape(messageID)), struct{}{}, &out)
	return out, err
}

// PutMessageReaction adds a reaction via PUT /v0/rooms/:roomId/messages/:messageId/reactions/:reactionId.
func (c *Client) PutMessageReaction(ctx context.Context, roomID, messageID, reactionID string) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/messages/%s/reactions/%s", url.PathEscape(roomID), url.PathEscape(messageID), url.PathEscape(reactionID)), struct{}{}, nil)
}

// DeleteMessageReaction removes a reaction via DELETE /v0/rooms/:roomId/messages/:messageId/reactions/:reactionId.
func (c *Client) DeleteMessageReaction(ctx context.Context, roomID, messageID, reactionID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s/messages/%s/reactions/%s", url.PathEscape(roomID), url.PathEscape(messageID), url.PathEscape(reactionID)), nil, nil)
}

// PutMessagePin pins a message via PUT /v0/rooms/:roomId/messages/:messageId/pin.
func (c *Client) PutMessagePin(ctx context.Context, roomID, messageID string) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/messages/%s/pin", url.PathEscape(roomID), url.PathEscape(messageID)), struct{}{}, nil)
}

// DeleteMessagePin unpins a message via DELETE /v0/rooms/:roomId/messages/:messageId/pin.
func (c *Client) DeleteMessagePin(ctx context.Context, roomID, messageID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/rooms/%s/messages/%s/pin", url.PathEscape(roomID), url.PathEscape(messageID)), nil, nil)
}

// ListMessagePins lists pinned messages via GET /v0/rooms/:roomId/pins.
func (c *Client) ListMessagePins(ctx context.Context, roomID string) ([]Message, error) {
	var out struct {
		Items []Message `json:"items"`
	}
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/pins", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

// ForwardRoomMessage forwards a message to another Room via POST /v0/rooms/:roomId/messages/:messageId/forward.
func (c *Client) ForwardRoomMessage(ctx context.Context, roomID, messageID, targetRoomID, idempotencyKey string) (Message, error) {
	headers := map[string]string{}
	if idempotencyKey != "" {
		headers["Idempotency-Key"] = idempotencyKey
	}
	var out Message
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/messages/%s/forward", url.PathEscape(roomID), url.PathEscape(messageID)), map[string]string{
		"target_room_id": targetRoomID,
	}, headers, &out)
	return out, err
}

// UpdateRoomReadState advances read_through_room_seq via PUT /v0/rooms/:roomId/read-state.
func (c *Client) UpdateRoomReadState(ctx context.Context, roomID string, roomSeq int64) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/read-state", url.PathEscape(roomID)), map[string]int64{
		"read_through_room_seq": roomSeq,
	}, nil)
}

// UpdateRoomPin pins or unpins a Room via PUT /v0/rooms/:roomId/pin.
func (c *Client) UpdateRoomPin(ctx context.Context, roomID string, pinned bool) error {
	return c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/rooms/%s/pin", url.PathEscape(roomID)), map[string]bool{
		"pinned": pinned,
	}, nil)
}

// NotifyRoomPresence sends a presence heartbeat via POST /v0/rooms/:roomId/presence.
func (c *Client) NotifyRoomPresence(ctx context.Context, roomID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/presence", url.PathEscape(roomID)), struct{}{}, nil)
}

// ListRoomEvents fetches committed Room events after seq via GET /v0/rooms/:roomId/events.
func (c *Client) ListRoomEvents(ctx context.Context, roomID string, after int64, limit int) (RoomEventPage, error) {
	q := url.Values{}
	q.Set("after", strconv.FormatInt(after, 10))
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var out RoomEventPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/events%s", url.PathEscape(roomID), BuildQuery(q)), nil, &out)
	return out, err
}

// --- Live Runs, Presentation Events, Background Tasks & Decisions ---

// ListRoomRunStatuses fetches GET /v0/rooms/:roomId/run-statuses.
func (c *Client) ListRoomRunStatuses(ctx context.Context, roomID string) ([]RoomRunStatus, error) {
	var out RoomRunStatusList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/run-statuses", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

// ListRoomRuntimePresentationRuns fetches GET /v0/rooms/:roomId/runtime-presentation-runs.
func (c *Client) ListRoomRuntimePresentationRuns(ctx context.Context, roomID string) ([]RuntimePresentationRun, error) {
	var out RuntimePresentationRunList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/runtime-presentation-runs", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

// ListRoomRuntimePresentationEvents fetches GET /v0/rooms/:roomId/runs/:runId/runtime-presentation-events?after=<ordinal>.
func (c *Client) ListRoomRuntimePresentationEvents(ctx context.Context, roomID, runID string, after int64) (RuntimePresentationEventPage, error) {
	q := url.Values{}
	if after > 0 {
		q.Set("after", strconv.FormatInt(after, 10))
	}
	var out RuntimePresentationEventPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/runs/%s/runtime-presentation-events%s", url.PathEscape(roomID), url.PathEscape(runID), BuildQuery(q)), nil, &out)
	return out, err
}

// CancelRoomRun cancels an active Agent Run via POST /v0/rooms/:roomId/runs/:runId/cancel.
func (c *Client) CancelRoomRun(ctx context.Context, roomID, runID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/runs/%s/cancel", url.PathEscape(roomID), url.PathEscape(runID)), struct{}{}, nil)
}

// RedeliverRoomRunUnconfirmedInputs retries unconfirmed inputs via POST /v0/rooms/:roomId/runs/:runId/redeliver-unconfirmed-inputs.
func (c *Client) RedeliverRoomRunUnconfirmedInputs(ctx context.Context, roomID, runID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/runs/%s/redeliver-unconfirmed-inputs", url.PathEscape(roomID), url.PathEscape(runID)), struct{}{}, nil)
}

// ListRoomBackgroundTasks fetches GET /v0/rooms/:roomId/background-tasks.
func (c *Client) ListRoomBackgroundTasks(ctx context.Context, roomID string) ([]RoomBackgroundTask, error) {
	var out RoomBackgroundTaskList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/background-tasks", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

// CancelRoomBackgroundTask cancels a background task via POST /v0/rooms/:roomId/background-tasks/:taskId/cancel.
func (c *Client) CancelRoomBackgroundTask(ctx context.Context, roomID, taskID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/background-tasks/%s/cancel", url.PathEscape(roomID), url.PathEscape(taskID)), struct{}{}, nil)
}

// DecideDecision submits a human decision via POST /v0/decisions/:decisionId.
func (c *Client) DecideDecision(ctx context.Context, decisionID string, req DecisionRequest) (Message, error) {
	var out Message
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/decisions/%s", url.PathEscape(decisionID)), req, &out)
	return out, err
}

// GetDecisionScreenshot downloads GET /v0/decisions/:decisionId/screenshot.
func (c *Client) GetDecisionScreenshot(ctx context.Context, decisionID string) ([]byte, string, error) {
	return c.DoBytes(ctx, http.MethodGet, fmt.Sprintf("/v0/decisions/%s/screenshot", url.PathEscape(decisionID)), nil, nil)
}
