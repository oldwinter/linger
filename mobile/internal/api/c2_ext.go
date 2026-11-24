package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func newIdempotencyKey() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("mob_%d", time.Now().UnixNano())
	}
	return "mob_" + hex.EncodeToString(b[:])
}

func resolveIdempotencyHeaders(key string) map[string]string {
	k := strings.TrimSpace(key)
	if k == "" {
		k = newIdempotencyKey()
	}
	return map[string]string{"Idempotency-Key": k}
}

// --- Work Items, Comments, Timeline & Task Projections ---

// WorkItemListOptions filters GET /v0/tenants/:tenantId/work-items.
type WorkItemListOptions struct {
	Scope           string // "personal" | "tenant"
	Kind            string // "issue" | "task"
	State           string // "open" | "in_progress" | "resolved"
	Priority        string
	Archived        *bool
	AssigneeActorID string
	Limit           int
	Cursor          string
}

// WorkItemCreateInput creates a Work Item via POST /v0/tenants/:tenantId/work-items.
type WorkItemCreateInput struct {
	Kind             string   `json:"kind"`
	Title            string   `json:"title"`
	Description      *string  `json:"description,omitempty"`
	Priority         *string  `json:"priority,omitempty"`
	AssigneeActorIDs []string `json:"assignee_actor_ids,omitempty"`
	OriginRoomID     *string  `json:"origin_room_id,omitempty"`
}

// WorkItemUpdateInput patches a Work Item via PATCH /v0/work-items/:workItemId.
type WorkItemUpdateInput struct {
	ExpectedVersion int64   `json:"expected_version"`
	Title           *string `json:"title,omitempty"`
	Description     *string `json:"description,omitempty"`
	Priority        *string `json:"priority,omitempty"`
}

// WorkItemCommentSegment is one structured segment in a Work Item comment.
type WorkItemCommentSegment struct {
	Type    string `json:"type"`
	Content string `json:"content"`
	ActorID string `json:"actor_id,omitempty"`
}

// WorkItemActivity represents one audit event in a Work Item's timeline.
type WorkItemActivity struct {
	ID            string         `json:"id"`
	WorkItemID    string         `json:"work_item_id"`
	Kind          string         `json:"kind"`
	Actor         ActorRef       `json:"actor"`
	FromState     *string        `json:"from_state,omitempty"`
	ToState       *string        `json:"to_state,omitempty"`
	TargetActorID *string        `json:"target_actor_id,omitempty"`
	CommentID     *string        `json:"comment_id,omitempty"`
	RoomID        *string        `json:"room_id,omitempty"`
	Details       map[string]any `json:"details,omitempty"`
	OccurredAt    time.Time      `json:"occurred_at"`
}

// WorkItemTimelineEntry represents either a comment or an activity entry.
type WorkItemTimelineEntry struct {
	Type     string            `json:"type"` // "comment" | "activity"
	Comment  *WorkItemComment  `json:"comment,omitempty"`
	Activity *WorkItemActivity `json:"activity,omitempty"`
}

// WorkItemTimelinePage wraps GET /v0/work-items/:workItemId/timeline.
type WorkItemTimelinePage struct {
	Items []WorkItemTimelineEntry `json:"items"`
	Page  PageMeta                `json:"page"`
}

// TaskConversationInput records one prompt/input delivered to a Task's Agent.
type TaskConversationInput struct {
	ID        string    `json:"id"`
	Body      string    `json:"body"`
	Source    string    `json:"source"`
	Author    ActorRef  `json:"author"`
	CreatedAt time.Time `json:"created_at"`
}

// TaskConversationCard records one AlterEgo decision card created for a Task.
type TaskConversationCard struct {
	DecisionID string    `json:"decision_id"`
	RoomID     string    `json:"room_id"`
	MessageID  string    `json:"message_id"`
	CreatedAt  time.Time `json:"created_at"`
}

// TaskConversation wraps GET /v0/tasks/:taskId/conversation.
type TaskConversation struct {
	Inputs []TaskConversationInput `json:"inputs"`
	Cards  []TaskConversationCard  `json:"cards"`
}

// TaskRuntimePresentationRunPage wraps GET /v0/tasks/:taskId/runtime-presentation-runs.
type TaskRuntimePresentationRunPage struct {
	WorkRoomID   *string         `json:"work_room_id,omitempty"`
	ActiveItems  []RoomRunStatus `json:"active_items"`
	HistoryItems []RoomRunStatus `json:"history_items"`
	NextCursor   *string         `json:"next_cursor,omitempty"`
}

// ListWorkItemsFiltered fetches filtered Work Items from GET /v0/tenants/:tenantId/work-items.
func (c *Client) ListWorkItemsFiltered(ctx context.Context, tenantID string, opts WorkItemListOptions) (WorkItemPage, error) {
	q := url.Values{}
	if opts.Scope != "" {
		q.Set("scope", opts.Scope)
	}
	if opts.Kind != "" {
		q.Set("kind", opts.Kind)
	}
	if opts.State != "" {
		q.Set("state", opts.State)
	}
	if opts.Priority != "" {
		q.Set("priority", opts.Priority)
	}
	if opts.Archived != nil {
		q.Set("archived", strconv.FormatBool(*opts.Archived))
	}
	if opts.AssigneeActorID != "" {
		q.Set("assignee_actor_id", opts.AssigneeActorID)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	var out WorkItemPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/work-items%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// CreateWorkItemIdempotent creates a Work Item with an Idempotency-Key header.
func (c *Client) CreateWorkItemIdempotent(ctx context.Context, tenantID string, in WorkItemCreateInput, idempotencyKey string) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/work-items", url.PathEscape(tenantID)), in, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// UpdateWorkItemIdempotent patches a Work Item with an Idempotency-Key header.
func (c *Client) UpdateWorkItemIdempotent(ctx context.Context, workItemID string, in WorkItemUpdateInput, idempotencyKey string) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSONWithHeaders(ctx, http.MethodPatch, fmt.Sprintf("/v0/work-items/%s", url.PathEscape(workItemID)), in, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// TransitionWorkItemIdempotent transitions a Work Item's state with an Idempotency-Key header.
func (c *Client) TransitionWorkItemIdempotent(ctx context.Context, workItemID, state string, resolution *string, expectedVersion int64, idempotencyKey string) (WorkItem, error) {
	body := map[string]any{
		"state":            state,
		"expected_version": expectedVersion,
	}
	if resolution != nil && *resolution != "" {
		body["resolution"] = *resolution
	}
	var out WorkItem
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/transitions", url.PathEscape(workItemID)), body, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// ArchiveWorkItemIdempotent archives a Work Item with an Idempotency-Key header.
func (c *Client) ArchiveWorkItemIdempotent(ctx context.Context, workItemID string, expectedVersion int64, idempotencyKey string) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/archive", url.PathEscape(workItemID)), map[string]int64{
		"expected_version": expectedVersion,
	}, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// UnarchiveWorkItemIdempotent unarchives a Work Item with an Idempotency-Key header.
func (c *Client) UnarchiveWorkItemIdempotent(ctx context.Context, workItemID string, expectedVersion int64, idempotencyKey string) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/unarchive", url.PathEscape(workItemID)), map[string]int64{
		"expected_version": expectedVersion,
	}, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// PutWorkItemAssignment assigns actorID to workItemID via PUT /v0/work-items/:workItemId/assignments/:actorId.
func (c *Client) PutWorkItemAssignment(ctx context.Context, workItemID, actorID, idempotencyKey string) (WorkItemAssignment, error) {
	var out WorkItemAssignment
	err := c.DoJSONWithHeaders(ctx, http.MethodPut, fmt.Sprintf("/v0/work-items/%s/assignments/%s", url.PathEscape(workItemID), url.PathEscape(actorID)), struct{}{}, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// DeleteWorkItemAssignment removes actorID from workItemID via DELETE /v0/work-items/:workItemId/assignments/:actorId.
func (c *Client) DeleteWorkItemAssignment(ctx context.Context, workItemID, actorID, idempotencyKey string) error {
	return c.DoJSONWithHeaders(ctx, http.MethodDelete, fmt.Sprintf("/v0/work-items/%s/assignments/%s", url.PathEscape(workItemID), url.PathEscape(actorID)), nil, resolveIdempotencyHeaders(idempotencyKey), nil)
}

// CreateWorkItemCommentIdempotent creates a Work Item comment with segments and Idempotency-Key.
func (c *Client) CreateWorkItemCommentIdempotent(ctx context.Context, workItemID, body, idempotencyKey string) (WorkItemComment, error) {
	req := map[string]any{
		"body": body,
		"segments": []WorkItemCommentSegment{
			{Type: "text", Content: body},
		},
	}
	var out WorkItemComment
	err := c.DoJSONWithHeaders(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/comments", url.PathEscape(workItemID)), req, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// UpdateWorkItemComment edits a Work Item comment via PATCH /v0/work-items/:workItemId/comments/:commentId.
func (c *Client) UpdateWorkItemComment(ctx context.Context, workItemID, commentID, body string, expectedVersion int64, idempotencyKey string) (WorkItemComment, error) {
	req := map[string]any{
		"body":             body,
		"expected_version": expectedVersion,
		"segments": []WorkItemCommentSegment{
			{Type: "text", Content: body},
		},
	}
	var out WorkItemComment
	err := c.DoJSONWithHeaders(ctx, http.MethodPatch, fmt.Sprintf("/v0/work-items/%s/comments/%s", url.PathEscape(workItemID), url.PathEscape(commentID)), req, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// DeleteWorkItemComment deletes a Work Item comment via DELETE /v0/work-items/:workItemId/comments/:commentId.
func (c *Client) DeleteWorkItemComment(ctx context.Context, workItemID, commentID string, expectedVersion int64, idempotencyKey string) (WorkItemComment, error) {
	var out WorkItemComment
	err := c.DoJSONWithHeaders(ctx, http.MethodDelete, fmt.Sprintf("/v0/work-items/%s/comments/%s", url.PathEscape(workItemID), url.PathEscape(commentID)), map[string]int64{
		"expected_version": expectedVersion,
	}, resolveIdempotencyHeaders(idempotencyKey), &out)
	return out, err
}

// ListWorkItemTimelineTyped fetches typed Work Item timeline entries.
func (c *Client) ListWorkItemTimelineTyped(ctx context.Context, workItemID string) (WorkItemTimelinePage, error) {
	var out WorkItemTimelinePage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/work-items/%s/timeline", url.PathEscape(workItemID)), nil, &out)
	return out, err
}

// GetTaskConversationTyped fetches GET /v0/tasks/:taskId/conversation.
func (c *Client) GetTaskConversationTyped(ctx context.Context, taskID string) (TaskConversation, error) {
	var out TaskConversation
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tasks/%s/conversation", url.PathEscape(taskID)), nil, &out)
	return out, err
}

// ListTaskRuntimePresentationRuns fetches GET /v0/tasks/:taskId/runtime-presentation-runs.
func (c *Client) ListTaskRuntimePresentationRuns(ctx context.Context, taskID string, limit int, cursor string) (TaskRuntimePresentationRunPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out TaskRuntimePresentationRunPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tasks/%s/runtime-presentation-runs%s", url.PathEscape(taskID), BuildQuery(q)), nil, &out)
	return out, err
}

// --- Routines ---

// RoutineCadence describes a scheduled Routine's recurrence rule.
type RoutineCadence struct {
	Kind            string     `json:"kind"` // "daily" | "weekly" | "every_n_hours" | "every_n_minutes" | "once"
	Timezone        string     `json:"timezone"`
	Hour            *int       `json:"hour,omitempty"`
	Minute          *int       `json:"minute,omitempty"`
	Weekdays        []string   `json:"weekdays,omitempty"`
	RunAt           *time.Time `json:"run_at,omitempty"`
	IntervalHours   *int       `json:"interval_hours,omitempty"`
	IntervalMinutes *int       `json:"interval_minutes,omitempty"`
}

// RoutineCreateInput creates a Routine via POST /v0/rooms/:roomId/routines.
type RoutineCreateInput struct {
	Name           string         `json:"name"`
	Instruction    string         `json:"instruction"`
	Cadence        RoutineCadence `json:"cadence"`
	Enabled        *bool          `json:"enabled,omitempty"`
	MentionActorID *string        `json:"mention_actor_id,omitempty"`
}

// RoutineUpdateInput patches a Routine via PATCH /v0/routines/:routineId.
type RoutineUpdateInput struct {
	ExpectedRevision int64           `json:"expected_revision"`
	Name             *string         `json:"name,omitempty"`
	Instruction      *string         `json:"instruction,omitempty"`
	Cadence          *RoutineCadence `json:"cadence,omitempty"`
	Enabled          *bool           `json:"enabled,omitempty"`
}

// CreateRoomRoutineTyped creates a Routine in roomID.
func (c *Client) CreateRoomRoutineTyped(ctx context.Context, roomID string, in RoutineCreateInput) (Routine, error) {
	var out Routine
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/routines", url.PathEscape(roomID)), in, &out)
	return out, err
}

// UpdateRoutineTyped updates a Routine via PATCH /v0/routines/:routineId.
func (c *Client) UpdateRoutineTyped(ctx context.Context, routineID string, in RoutineUpdateInput) (Routine, error) {
	var out Routine
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/routines/%s", url.PathEscape(routineID)), in, &out)
	return out, err
}

// RunRoutineNowTyped triggers a Routine via POST /v0/routines/:routineId/run and returns the updated Routine.
func (c *Client) RunRoutineNowTyped(ctx context.Context, routineID string) (Routine, error) {
	var out Routine
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/routines/%s/run", url.PathEscape(routineID)), struct{}{}, &out)
	return out, err
}

// DeleteRoutineWithRevision deletes a Routine with the required expected_revision query parameter.
func (c *Client) DeleteRoutineWithRevision(ctx context.Context, routineID string, expectedRevision int64) error {
	if expectedRevision < 1 {
		expectedRevision = 1
	}
	q := url.Values{}
	q.Set("expected_revision", strconv.FormatInt(expectedRevision, 10))
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/routines/%s%s", url.PathEscape(routineID), BuildQuery(q)), nil, nil)
}

// --- Pocket Notes ---

// PocketNoteRecord represents one daily Pocket Note page, supporting both
// TeamHub's canonical ("date", "text") schema and Wave B's ("note_date", "body") fixture schema.
type PocketNoteRecord struct {
	Date      string    `json:"date"`
	Text      string    `json:"text"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UnmarshalJSON accepts both TeamHub ("date"/"text") and legacy ("note_date"/"body") fields.
func (p *PocketNoteRecord) UnmarshalJSON(data []byte) error {
	var raw struct {
		Date      string    `json:"date"`
		NoteDate  string    `json:"note_date"`
		Text      string    `json:"text"`
		Body      string    `json:"body"`
		UpdatedAt time.Time `json:"updated_at"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	p.Date = raw.Date
	if p.Date == "" {
		p.Date = raw.NoteDate
	}
	p.Text = raw.Text
	if p.Text == "" {
		p.Text = raw.Body
	}
	p.UpdatedAt = raw.UpdatedAt
	return nil
}

// ToPocketNote converts a PocketNoteRecord into the Wave B cache.Store PocketNote representation.
func (p PocketNoteRecord) ToPocketNote() PocketNote {
	return PocketNote{
		NoteDate:  p.Date,
		Body:      p.Text,
		UpdatedAt: p.UpdatedAt,
	}
}

// PocketNoteRecordPage wraps GET /v0/tenants/:tenantId/me/pocket-notes.
type PocketNoteRecordPage struct {
	Today string             `json:"today"`
	Items []PocketNoteRecord `json:"items"`
	Page  PageMeta           `json:"page"`
}

// ListPocketNotesC2 lists daily Pocket Notes using TeamHub's canonical fields.
func (c *Client) ListPocketNotesC2(ctx context.Context, tenantID string, limit int, cursor string) (PocketNoteRecordPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out PocketNoteRecordPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/pocket-notes%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// PutTodayPocketNoteC2 updates today's Pocket Note via PUT /v0/tenants/:tenantId/me/pocket-notes/today.
func (c *Client) PutTodayPocketNoteC2(ctx context.Context, tenantID, text string) (PocketNoteRecord, error) {
	var out PocketNoteRecord
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/pocket-notes/today", url.PathEscape(tenantID)), map[string]string{
		"text": text,
	}, &out)
	return out, err
}

// --- Library Documents, Trees, History, Comments, Link Share & Preview ---

// DocumentTreeNode represents either a folder or document placement in a tree.
type DocumentTreeNode struct {
	ID         string    `json:"id"`
	NodeKind   string    `json:"node_kind"` // "folder" | "document"
	ParentID   *string   `json:"parent_id,omitempty"`
	SortKey    string    `json:"sort_key"`
	Name       string    `json:"name,omitempty"`
	DocumentID string    `json:"document_id,omitempty"`
	Document   *Document `json:"document,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// DocumentTree wraps GET /v0/tenants/:tenantId/me/document-tree and .../shared-document-tree.
type DocumentTree struct {
	Items []DocumentTreeNode `json:"items"`
}

// DocumentHistoryActor identifies the contributor on a history entry.
type DocumentHistoryActor struct {
	ActorID     string `json:"actor_id,omitempty"`
	ID          string `json:"id,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
}

// DocumentHistoryEntry represents one revision checkpoint in GET /v0/documents/:documentId/history.
type DocumentHistoryEntry struct {
	ID           string               `json:"id"`
	DocumentID   string               `json:"document_id"`
	RevisionID   string               `json:"revision_id"`
	PersistedSeq int64                `json:"persisted_seq"`
	Trigger      string               `json:"trigger"`
	CreatedBy    DocumentHistoryActor `json:"created_by"`
	CreatedAt    time.Time            `json:"created_at"`
}

// DocumentHistoryPage wraps GET /v0/documents/:documentId/history.
type DocumentHistoryPage struct {
	Items []DocumentHistoryEntry `json:"items"`
	Page  PageMeta               `json:"page"`
}

// DocumentLinkShare represents GET/PUT /v0/documents/:documentId/link-share.
type DocumentLinkShare struct {
	ID         string  `json:"id"`
	DocumentID string  `json:"document_id"`
	Role       string  `json:"role"`   // "viewer" | "editor"
	Status     string  `json:"status"` // "active" | "inactive" | "revoked"
	Token      *string `json:"token,omitempty"`
	URL        *string `json:"url,omitempty"`
	Version    int64   `json:"version"`
}

// DocumentPreviewSession is returned by POST /v0/document-versions/:documentVersionId/preview-sessions.
type DocumentPreviewSession struct {
	PreviewURL string    `json:"preview_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// GetMyDocumentTreeTyped fetches the caller's personal Document tree.
func (c *Client) GetMyDocumentTreeTyped(ctx context.Context, tenantID string) (DocumentTree, error) {
	var out DocumentTree
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/document-tree", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// GetMySharedDocumentTreeTyped fetches the caller's shared Document tree.
func (c *Client) GetMySharedDocumentTreeTyped(ctx context.Context, tenantID string) (DocumentTree, error) {
	var out DocumentTree
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/shared-document-tree", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// ListRoomDocuments fetches GET /v0/rooms/:roomId/documents.
func (c *Client) ListRoomDocuments(ctx context.Context, roomID string, limit int, cursor string) (DocumentPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out DocumentPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/documents%s", url.PathEscape(roomID), BuildQuery(q)), nil, &out)
	return out, err
}

// CreateDocument creates a native Document via POST /v0/tenants/:tenantId/documents.
func (c *Client) CreateDocument(ctx context.Context, tenantID string, parentID *string, reprFormat string) (Document, error) {
	body := map[string]any{}
	if parentID != nil && *parentID != "" {
		body["parent_id"] = *parentID
	}
	if reprFormat != "" {
		body["representation_format"] = reprFormat
	}
	var out Document
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/documents", url.PathEscape(tenantID)), body, &out)
	return out, err
}

// UpdateDocumentMetadata renames a Document via PATCH /v0/documents/:documentId.
func (c *Client) UpdateDocumentMetadata(ctx context.Context, docID, title string) (Document, error) {
	var out Document
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/documents/%s", url.PathEscape(docID)), map[string]string{
		"title": title,
	}, &out)
	return out, err
}

// DeleteDocument trashes a Document via DELETE /v0/documents/:documentId.
func (c *Client) DeleteDocument(ctx context.Context, docID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/documents/%s", url.PathEscape(docID)), nil, nil)
}

// UploadTenantDocument uploads a file via POST /v0/tenants/:tenantId/documents/uploads.
func (c *Client) UploadTenantDocument(ctx context.Context, tenantID, filename, reprFormat, mediaType string, parentID *string, data []byte, idempotencyKey string) (Document, error) {
	if reprFormat == "" {
		reprFormat = "file"
	}
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("filename", filename); err != nil {
		return Document{}, err
	}
	if err := mw.WriteField("representation_format", reprFormat); err != nil {
		return Document{}, err
	}
	if err := mw.WriteField("media_type", mediaType); err != nil {
		return Document{}, err
	}
	if parentID != nil && *parentID != "" {
		if err := mw.WriteField("parent_id", *parentID); err != nil {
			return Document{}, err
		}
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="content"; filename="%s"`, strings.ReplaceAll(filename, `"`, `_`)))
	h.Set("Content-Type", mediaType)
	part, err := mw.CreatePart(h)
	if err != nil {
		return Document{}, err
	}
	if _, err := part.Write(data); err != nil {
		return Document{}, err
	}
	if err := mw.Close(); err != nil {
		return Document{}, err
	}

	headers := resolveIdempotencyHeaders(idempotencyKey)
	headers["Content-Type"] = mw.FormDataContentType()
	raw, _, err := c.DoBytes(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/documents/uploads", url.PathEscape(tenantID)), &buf, headers)
	if err != nil {
		return Document{}, err
	}
	var out Document
	if err := json.Unmarshal(raw, &out); err != nil {
		return Document{}, fmt.Errorf("api: decode document upload: %w", err)
	}
	return out, nil
}

// ListDocumentHistory fetches GET /v0/documents/:documentId/history.
func (c *Client) ListDocumentHistory(ctx context.Context, docID string, limit int) (DocumentHistoryPage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var out DocumentHistoryPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/history%s", url.PathEscape(docID), BuildQuery(q)), nil, &out)
	return out, err
}

// RestoreDocumentHistoryEntry restores a checkpoint via POST /v0/documents/:documentId/history/:historyEntryId/restore.
func (c *Client) RestoreDocumentHistoryEntry(ctx context.Context, docID, historyEntryID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/documents/%s/history/%s/restore", url.PathEscape(docID), url.PathEscape(historyEntryID)), struct{}{}, nil)
}

// CreateDocumentPreviewSession creates a signed HTML preview capability URL for versionID.
func (c *Client) CreateDocumentPreviewSession(ctx context.Context, versionID string) (DocumentPreviewSession, error) {
	var out DocumentPreviewSession
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/document-versions/%s/preview-sessions", url.PathEscape(versionID)), struct{}{}, &out)
	return out, err
}

// CreateDocumentCommentThread creates a comment thread via POST /v0/documents/:documentId/comment-threads.
func (c *Client) CreateDocumentCommentThread(ctx context.Context, docID, body string) (DocumentCommentThread, error) {
	req := map[string]any{
		"initial_comment": map[string]any{
			"segments": []map[string]string{
				{"type": "text", "content": body},
			},
		},
	}
	var out DocumentCommentThread
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/documents/%s/comment-threads", url.PathEscape(docID)), req, &out)
	return out, err
}

// ReplyDocumentCommentThread adds a reply to threadID via POST /v0/document-comment-threads/:threadId/comments.
func (c *Client) ReplyDocumentCommentThread(ctx context.Context, threadID, body string) (DocumentComment, error) {
	req := map[string]any{
		"segments": []map[string]string{
			{"type": "text", "content": body},
		},
	}
	var out DocumentComment
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/document-comment-threads/%s/comments", url.PathEscape(threadID)), req, &out)
	return out, err
}

// SetDocumentCommentThreadResolved resolves or reopens a Document comment thread.
func (c *Client) SetDocumentCommentThreadResolved(ctx context.Context, threadID string, resolved bool) (DocumentCommentThread, error) {
	var out DocumentCommentThread
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/document-comment-threads/%s", url.PathEscape(threadID)), map[string]bool{
		"resolved": resolved,
	}, &out)
	return out, err
}

// GetDocumentLinkShare fetches GET /v0/documents/:documentId/link-share.
func (c *Client) GetDocumentLinkShare(ctx context.Context, docID string) (DocumentLinkShare, error) {
	var out DocumentLinkShare
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/documents/%s/link-share", url.PathEscape(docID)), nil, &out)
	return out, err
}

// SetDocumentLinkShare updates or resets a Document's link share policy.
func (c *Client) SetDocumentLinkShare(ctx context.Context, docID, role string, expectedVersion int64, reset bool) (DocumentLinkShare, error) {
	body := map[string]any{
		"role":             role,
		"expected_version": expectedVersion,
	}
	if reset {
		body["reset"] = true
	}
	var out DocumentLinkShare
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/documents/%s/link-share", url.PathEscape(docID)), body, &out)
	return out, err
}

// RevokeDocumentLinkShare revokes a Document's link share.
func (c *Client) RevokeDocumentLinkShare(ctx context.Context, docID string, expectedVersion int64) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/documents/%s/link-share", url.PathEscape(docID)), map[string]int64{
		"expected_version": expectedVersion,
	}, nil)
}

// --- Personal Wiki, Knowledge Graph & Memory ---

// WikiGraphNode represents one entity/page in the Personal Knowledge Graph.
type WikiGraphNode struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Category    string   `json:"category,omitempty"`
	Description string   `json:"description,omitempty"`
	Body        string   `json:"body,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Links       []string `json:"links,omitempty"`
	Backlinks   []string `json:"backlinks,omitempty"`
	Size        int      `json:"size,omitempty"`
}

// WikiGraphEdge links two WikiGraphNodes.
type WikiGraphEdge struct {
	Source   string  `json:"source"`
	Target   string  `json:"target"`
	Kind     string  `json:"kind,omitempty"`
	Strength float64 `json:"strength,omitempty"`
}

// WikiGraphData holds parsed nodes and edges for native rendering.
type WikiGraphData struct {
	Root        string          `json:"root,omitempty"`
	GeneratedAt string          `json:"generatedAt,omitempty"`
	Types       []string        `json:"types,omitempty"`
	Nodes       []WikiGraphNode `json:"nodes"`
	Edges       []WikiGraphEdge `json:"edges"`
}

// MemoryMeetingFiles links a Meeting memory entry to its Voice Capture and Documents.
type MemoryMeetingFiles struct {
	CaptureID            string    `json:"capture_id"`
	RecordingDocumentID  string    `json:"recording_document_id"`
	RecordingFilename    string    `json:"recording_filename"`
	RecordingVersionID   string    `json:"recording_version_id"`
	StartedAt            time.Time `json:"started_at"`
	SummaryPath          *string   `json:"summary_path,omitempty"`
	SummaryReady         bool      `json:"summary_ready"`
	TranscriptDocumentID string    `json:"transcript_document_id"`
	TranscriptVersionID  string    `json:"transcript_version_id"`
}

// PersonalMemoryEntryC2 represents a daily/weekly/meeting Memory entry.
type PersonalMemoryEntryC2 struct {
	ID        string              `json:"id"`
	Kind      string              `json:"kind,omitempty"`
	Title     string              `json:"title,omitempty"`
	Summary   string              `json:"summary,omitempty"`
	Content   string              `json:"content,omitempty"`
	Date      *string             `json:"date,omitempty"`
	Path      string              `json:"path,omitempty"`
	Meeting   *MemoryMeetingFiles `json:"meeting,omitempty"`
	UpdatedAt time.Time           `json:"updated_at"`
}

// PersonalMemoryPageC2 wraps GET /v0/tenants/:tenantId/memory.
type PersonalMemoryPageC2 struct {
	Items      []PersonalMemoryEntryC2 `json:"items"`
	NextCursor *string                 `json:"next_cursor,omitempty"`
	Page       PageMeta                `json:"page,omitempty"`
}

// GetPersonalWikiPreview fetches GET /v0/tenants/:tenantId/personal-wiki/preview.
func (c *Client) GetPersonalWikiPreview(ctx context.Context, tenantID, refreshID string) (map[string]string, error) {
	q := url.Values{}
	if refreshID != "" {
		q.Set("refresh_id", refreshID)
	}
	var out map[string]string
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-wiki/preview%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// GetPersonalWikiGraphData fetches GET /v0/tenants/:tenantId/personal-wiki/graph
// and extracts structured nodes and edges from either raw JSON or TeamHub's HTML visualization.
func (c *Client) GetPersonalWikiGraphData(ctx context.Context, tenantID string) (WikiGraphData, error) {
	raw, _, err := c.DoBytes(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-wiki/graph", url.PathEscape(tenantID)), nil, nil)
	if err != nil {
		return WikiGraphData{}, err
	}
	return ParseWikiGraphPayload(raw)
}

// ParseWikiGraphPayload extracts WikiGraphData from either raw JSON or embedded
// "const graph={...};" HTML served by TeamHub's memory graph visualization endpoint.
func ParseWikiGraphPayload(raw []byte) (WikiGraphData, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return WikiGraphData{}, errors.New("api: empty wiki graph payload")
	}
	if trimmed[0] == '{' {
		var out WikiGraphData
		if err := json.Unmarshal(trimmed, &out); err != nil {
			return WikiGraphData{}, fmt.Errorf("api: decode wiki graph JSON: %w", err)
		}
		return out, nil
	}
	marker := []byte("const graph=")
	idx := bytes.Index(trimmed, marker)
	if idx < 0 {
		return WikiGraphData{}, errors.New("api: wiki graph JSON not found in payload")
	}
	rest := trimmed[idx+len(marker):]
	start := bytes.IndexByte(rest, '{')
	if start < 0 {
		return WikiGraphData{}, errors.New("api: wiki graph JSON object start not found")
	}
	rest = rest[start:]
	dec := json.NewDecoder(bytes.NewReader(rest))
	var out WikiGraphData
	if err := dec.Decode(&out); err != nil {
		return WikiGraphData{}, fmt.Errorf("api: decode embedded wiki graph: %w", err)
	}
	return out, nil
}

// ListPersonalMemoryC2 fetches GET /v0/tenants/:tenantId/memory with optional kind filter.
func (c *Client) ListPersonalMemoryC2(ctx context.Context, tenantID, kind string, limit int, cursor string) (PersonalMemoryPageC2, error) {
	q := url.Values{}
	if kind != "" {
		q.Set("kind", kind)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out PersonalMemoryPageC2
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/memory%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

// GetPersonalMemoryEntry fetches GET /v0/tenants/:tenantId/memory/:entryId.
func (c *Client) GetPersonalMemoryEntry(ctx context.Context, tenantID, entryID string) (PersonalMemoryEntryC2, error) {
	var out PersonalMemoryEntryC2
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/memory/%s", url.PathEscape(tenantID), url.PathEscape(entryID)), nil, &out)
	return out, err
}

// --- Settings: Proactive Rules, Personal Profile, Connectors, Search & Voice Keys ---

// ProactiveShadowDivergence shows where a shadow rule would have acted differently.
type ProactiveShadowDivergence struct {
	ID               string    `json:"id"`
	RuleID           string    `json:"rule_id"`
	GuidelineVersion int       `json:"guideline_version"`
	Matter           string    `json:"matter"`
	TakenAction      string    `json:"taken_action"`
	ShadowAction     string    `json:"shadow_action"`
	CreatedAt        time.Time `json:"created_at"`
}

// ProactiveRuleBookC2 is the full rule book returned by GET and all proactive-rule mutations.
type ProactiveRuleBookC2 struct {
	Version     int                         `json:"version"`
	Rules       []ProactiveRule             `json:"rules"`
	Divergences []ProactiveShadowDivergence `json:"divergences,omitempty"`
	Clues       []json.RawMessage           `json:"clues,omitempty"`
	Mandates    []json.RawMessage           `json:"mandates,omitempty"`
}

// PersonalProfileRevisionC2 represents one Personal Profile revision.
type PersonalProfileRevisionC2 struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenant_id,omitempty"`
	PromptVersion string    `json:"prompt_version,omitempty"`
	Markdown      string    `json:"markdown"`
	SourceApps    []string  `json:"source_apps,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// PersonalProfileC2 wraps GET /v0/tenants/:tenantId/personal-profile.
type PersonalProfileC2 struct {
	BuildingSince *time.Time                  `json:"building_since,omitempty"`
	Current       *PersonalProfileRevisionC2  `json:"current,omitempty"`
	History       []PersonalProfileRevisionC2 `json:"history"`
	HasMore       bool                        `json:"has_more"`
}

// ExternalConnectionC2 mirrors TeamHub's ExternalConnection schema including check fields.
type ExternalConnectionC2 struct {
	ID                     string     `json:"id"`
	Provider               string     `json:"provider"`
	Status                 string     `json:"status"`
	IdentityLabel          *string    `json:"identity_label,omitempty"`
	AutoReminders          bool       `json:"auto_reminders"`
	ConnectURL             *string    `json:"connect_url,omitempty"`
	Revision               int64      `json:"revision"`
	StatusCheckRequestedAt *time.Time `json:"status_check_requested_at,omitempty"`
	StatusCheckedAt        *time.Time `json:"status_checked_at,omitempty"`
	StatusErrorCode        *string    `json:"status_error_code,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// ExternalConnectionAgentAccess represents one Agent's permission on an external connection.
type ExternalConnectionAgentAccess struct {
	AgentActorID      string `json:"agent_actor_id"`
	AgentManagementID string `json:"agent_management_id"`
	AgentDisplayName  string `json:"agent_display_name"`
	TenantID          string `json:"tenant_id"`
	Granted           bool   `json:"granted"`
	Revision          int64  `json:"revision"`
}

// VoiceProviderKeyStatusC2 decodes both TeamHub's {source, can_save} and Wave B's {configured, source}.
type VoiceProviderKeyStatusC2 struct {
	Source     string `json:"source"`
	CanSave    bool   `json:"can_save"`
	Configured bool   `json:"configured"`
}

// UnmarshalJSON derives Configured when TeamHub omits the boolean and populates CanSave.
func (v *VoiceProviderKeyStatusC2) UnmarshalJSON(data []byte) error {
	var raw struct {
		Source     string `json:"source"`
		CanSave    *bool  `json:"can_save"`
		Configured *bool  `json:"configured"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	v.Source = raw.Source
	if raw.CanSave != nil {
		v.CanSave = *raw.CanSave
	} else {
		v.CanSave = raw.Source != "environment"
	}
	if raw.Configured != nil {
		v.Configured = *raw.Configured
	} else {
		v.Configured = raw.Source != "" && raw.Source != "none"
	}
	return nil
}

// VoiceMediaPolicyC2 mirrors GET /v0/tenants/:tenantId/voice-media-policy.
type VoiceMediaPolicyC2 struct {
	ActiveRoomID        *string                   `json:"active_room_id,omitempty"`
	VoiceAvailable      *bool                     `json:"voice_available,omitempty"`
	VoiceMediaSupported bool                      `json:"voice_media_supported"`
	LiveEnabled         *bool                     `json:"live_enabled,omitempty"`
	LiveSupported       *bool                     `json:"live_supported,omitempty"`
	SonioxKey           *VoiceProviderKeyStatusC2 `json:"soniox_key,omitempty"`
	XaiKey              *VoiceProviderKeyStatusC2 `json:"xai_key,omitempty"`
}

// ListProactiveRulesC2 fetches GET /v0/tenants/:tenantId/me/proactive-rules.
func (c *Client) ListProactiveRulesC2(ctx context.Context, tenantID string) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// EditProactiveRuleBook edits a rule and returns the updated ProactiveRuleBookC2.
func (c *Client) EditProactiveRuleBook(ctx context.Context, tenantID, ruleID, text string) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]string{
		"text": text,
	}, &out)
	return out, err
}

// SetProactiveRulePinBook pins/unpins a rule and returns the updated ProactiveRuleBookC2.
func (c *Client) SetProactiveRulePinBook(ctx context.Context, tenantID, ruleID string, pinned bool) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/pin", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]bool{
		"pinned": pinned,
	}, &out)
	return out, err
}

// SetProactiveRuleMandateBook sets a rule mandate and returns the updated ProactiveRuleBookC2.
func (c *Client) SetProactiveRuleMandateBook(ctx context.Context, tenantID, ruleID, mandate string) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/mandate", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]string{
		"mandate": mandate,
	}, &out)
	return out, err
}

// PromoteProactiveRuleBook promotes a shadow rule to active and returns the updated ProactiveRuleBookC2.
func (c *Client) PromoteProactiveRuleBook(ctx context.Context, tenantID, ruleID string) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/promotion", url.PathEscape(tenantID), url.PathEscape(ruleID)), struct{}{}, &out)
	return out, err
}

// DeleteProactiveRuleBook deletes a rule and returns the updated ProactiveRuleBookC2.
func (c *Client) DeleteProactiveRuleBook(ctx context.Context, tenantID, ruleID string) (ProactiveRuleBookC2, error) {
	var out ProactiveRuleBookC2
	err := c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s", url.PathEscape(tenantID), url.PathEscape(ruleID)), nil, &out)
	return out, err
}

// GetPersonalProfileC2 fetches GET /v0/tenants/:tenantId/personal-profile.
func (c *Client) GetPersonalProfileC2(ctx context.Context, tenantID string) (PersonalProfileC2, error) {
	var out PersonalProfileC2
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/personal-profile", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// ReplacePersonalProfile publishes an edited Personal Profile revision.
func (c *Client) ReplacePersonalProfile(ctx context.Context, tenantID, baseRevisionID, markdown string) (PersonalProfileRevisionC2, error) {
	var out PersonalProfileRevisionC2
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/personal-profile/revisions", url.PathEscape(tenantID)), map[string]string{
		"base_revision_id": baseRevisionID,
		"markdown":         markdown,
	}, &out)
	return out, err
}

// ListExternalConnectionsC2 fetches GET /v0/external-connections.
func (c *Client) ListExternalConnectionsC2(ctx context.Context) ([]ExternalConnectionC2, error) {
	var out struct {
		Connections []ExternalConnectionC2 `json:"connections"`
	}
	err := c.DoJSON(ctx, http.MethodGet, "/v0/external-connections", nil, &out)
	return out.Connections, err
}

// CheckExternalConnectionStatus runs a live status check via POST /v0/external-connections/:id/status-checks.
func (c *Client) CheckExternalConnectionStatus(ctx context.Context, connID string, expectedRevision int64) (ExternalConnectionC2, error) {
	var out ExternalConnectionC2
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/external-connections/%s/status-checks", url.PathEscape(connID)), map[string]int64{
		"expected_revision": expectedRevision,
	}, &out)
	return out, err
}

// DisconnectExternalConnectionC2 disconnects an external connection with expected_revision.
func (c *Client) DisconnectExternalConnectionC2(ctx context.Context, connID string, expectedRevision int64) (ExternalConnectionC2, error) {
	var out ExternalConnectionC2
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/external-connections/%s/disconnects", url.PathEscape(connID)), map[string]int64{
		"expected_revision": expectedRevision,
	}, &out)
	return out, err
}

// ListExternalConnectionAgentGrants lists per-agent access grants for connID.
func (c *Client) ListExternalConnectionAgentGrants(ctx context.Context, connID string) ([]ExternalConnectionAgentAccess, error) {
	var out struct {
		Agents []ExternalConnectionAgentAccess `json:"agents"`
	}
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/external-connections/%s/agent-grants", url.PathEscape(connID)), nil, &out)
	return out.Agents, err
}

// SetExternalConnectionAgentGrant toggles an agent's access grant on connID.
func (c *Client) SetExternalConnectionAgentGrant(ctx context.Context, connID, agentActorID string, granted bool) (ExternalConnectionAgentAccess, error) {
	var out ExternalConnectionAgentAccess
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/external-connections/%s/agent-grants/%s", url.PathEscape(connID), url.PathEscape(agentActorID)), map[string]bool{
		"granted": granted,
	}, &out)
	return out, err
}

// SetExternalConnectionAutoRemindersC2 toggles auto-reminders using TeamHub's {"enabled": bool} field.
func (c *Client) SetExternalConnectionAutoRemindersC2(ctx context.Context, connID string, enabled bool) (ExternalConnectionC2, error) {
	var out ExternalConnectionC2
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/external-connections/%s/auto-reminders", url.PathEscape(connID)), map[string]bool{
		"enabled": enabled,
	}, &out)
	return out, err
}

// ClearWebSearchDefault clears any custom web search default via DELETE /v0/web-search/default.
func (c *Client) ClearWebSearchDefault(ctx context.Context) error {
	return c.DoJSON(ctx, http.MethodDelete, "/v0/web-search/default", nil, nil)
}

// GetVoiceMediaPolicyC2 fetches GET /v0/tenants/:tenantId/voice-media-policy.
func (c *Client) GetVoiceMediaPolicyC2(ctx context.Context, tenantID string) (VoiceMediaPolicyC2, error) {
	var out VoiceMediaPolicyC2
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/voice-media-policy", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

// SaveVoiceProviderKeyC2 validates and stores a voice provider API key.
func (c *Client) SaveVoiceProviderKeyC2(ctx context.Context, provider, apiKey string) (VoiceProviderKeyStatusC2, error) {
	var out VoiceProviderKeyStatusC2
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/voice-provider-keys/%s", url.PathEscape(provider)), map[string]string{
		"api_key": apiKey,
	}, &out)
	return out, err
}
