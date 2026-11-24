package api

import (
	"encoding/json"
	"time"
)

// LatestMessageSummary is embedded in RoomListItem.
type LatestMessageSummary struct {
	ID          string    `json:"id"`
	RoomSeq     int64     `json:"room_seq,omitempty"`
	RawMessage  string    `json:"raw_message"`
	MessageKind string    `json:"message_kind,omitempty"`
	Author      ActorRef  `json:"author"`
	CreatedAt   time.Time `json:"created_at"`
}

// Room represents a Room detail record from GET/POST/PATCH /v0/rooms/:roomId.
type Room struct {
	ID               string    `json:"id"`
	TenantID         string    `json:"tenant_id"`
	Kind             string    `json:"kind"` // "group" | "direct" | "thread" | "work"
	Name             string    `json:"name"`
	Description      *string   `json:"description,omitempty"`
	CreatedBy        ActorRef  `json:"created_by"`
	DirectPeer       *ActorRef `json:"direct_peer,omitempty"`
	DirectPeerActive *bool     `json:"direct_peer_active,omitempty"`
	ParentRoomID     *string   `json:"parent_room_id,omitempty"`
	RootMessageID    *string   `json:"root_message_id,omitempty"`
	Participation    *string   `json:"participation,omitempty"`
	SnapshotRoomSeq  *int64    `json:"snapshot_room_seq,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// RoomListItem is returned by GET /v0/tenants/:tenantId/rooms.
type RoomListItem struct {
	ID                 string                `json:"id"`
	TenantID           string                `json:"tenant_id"`
	Kind               string                `json:"kind"`
	Name               string                `json:"name"`
	Description        *string               `json:"description,omitempty"`
	CreatedBy          ActorRef              `json:"created_by"`
	DirectPeer         *ActorRef             `json:"direct_peer,omitempty"`
	DirectPeerActive   *bool                 `json:"direct_peer_active,omitempty"`
	ParentRoomID       *string               `json:"parent_room_id,omitempty"`
	RootMessageID      *string               `json:"root_message_id,omitempty"`
	Participation      *string               `json:"participation,omitempty"`
	MemberPreview      []ActorRef            `json:"member_preview,omitempty"`
	LatestMessage      *LatestMessageSummary `json:"latest_message,omitempty"`
	LatestRoomSeq      int64                 `json:"latest_room_seq"`
	ReadThroughRoomSeq int64                 `json:"read_through_room_seq"`
	UnreadMessageCount int64                 `json:"unread_message_count"`
	UnreadMentionCount int64                 `json:"unread_mention_count"`
	PinnedAt           *time.Time            `json:"pinned_at,omitempty"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
}

// RoomListPage wraps GET /v0/tenants/:tenantId/rooms.
type RoomListPage struct {
	Items []RoomListItem `json:"items"`
	Page  PageMeta       `json:"page"`
}

// RoomMember represents a Room member row.
type RoomMember struct {
	RoomID    string    `json:"room_id"`
	Actor     ActorRef  `json:"actor"`
	AddedBy   ActorRef  `json:"added_by"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RoomMemberPage wraps GET /v0/rooms/:roomId/members.
type RoomMemberPage struct {
	Items           []RoomMember `json:"items"`
	Page            PageMeta     `json:"page"`
	SnapshotRoomSeq *int64       `json:"snapshot_room_seq,omitempty"`
}

// MessageAttachment references an immutable Document Version attached to a Message.
type MessageAttachment struct {
	DocumentID        string `json:"document_id"`
	DocumentVersionID string `json:"document_version_id"`
	Filename          string `json:"filename"`
	MediaType         string `json:"media_type"`
	SizeBytes         int64  `json:"size_bytes"`
}

// MessageSegment is one structured text, mention, or inline html_fragment segment of a Message.
type MessageSegment struct {
	Type    string    `json:"type"`
	Content string    `json:"content"`
	HTML    string    `json:"html,omitempty"`
	Actor   *ActorRef `json:"actor,omitempty"`
}

// MessageReaction represents grouped emoji reactions on a Message.
type MessageReaction struct {
	ReactionID string     `json:"reaction_id"`
	Emoji      string     `json:"emoji,omitempty"`
	Count      int        `json:"count"`
	Reacted    bool       `json:"reacted,omitempty"`
	Actors     []ActorRef `json:"actors,omitempty"`
}

// MessageThreadSummary summarizes a message's attached Thread room.
type MessageThreadSummary struct {
	ThreadRoomID  string     `json:"thread_room_id"`
	ReplyCount    int64      `json:"reply_count"`
	LatestReplyAt *time.Time `json:"latest_reply_at,omitempty"`
}

// Message represents a single Room Message.
type Message struct {
	ID                   string                        `json:"id"`
	TenantID             string                        `json:"tenant_id"`
	RoomID               string                        `json:"room_id"`
	RoomSeq              *int64                        `json:"room_seq,omitempty"`
	Author               ActorRef                      `json:"author"`
	MessageKind          string                        `json:"message_kind"`
	RawMessage           string                        `json:"raw_message"`
	Segments             []MessageSegment              `json:"segments"`
	Attachments          []MessageAttachment           `json:"attachments"`
	Card                 *DecisionRequestedMessageCard `json:"card,omitempty"`
	CardTitle            *string                       `json:"card_title,omitempty"`
	CardKind             *string                       `json:"card_kind,omitempty"`
	CardContextMessageID *string                       `json:"card_context_message_id,omitempty"`
	Notice               json.RawMessage               `json:"notice,omitempty"`
	Reactions            []MessageReaction             `json:"reactions,omitempty"`
	ReplyToMessageID     *string                       `json:"reply_to_message_id,omitempty"`
	RoutineName          *string                       `json:"routine_name,omitempty"`
	Thread               *MessageThreadSummary         `json:"thread,omitempty"`
	CreatedAt            time.Time                     `json:"created_at"`
}

// MessagePage wraps GET /v0/rooms/:roomId/messages.
type MessagePage struct {
	Items           []Message `json:"items"`
	Page            PageMeta  `json:"page"`
	SnapshotRoomSeq int64     `json:"snapshot_room_seq"`
}

// CreateMessageRequest posts a message to POST /v0/rooms/:roomId/messages.
type CreateMessageRequest struct {
	RawMessage          string   `json:"raw_message,omitempty"`
	Segments            []any    `json:"segments,omitempty"`
	ReplyToMessageID    *string  `json:"reply_to_message_id,omitempty"`
	AttachmentUploadIDs []string `json:"attachment_upload_ids,omitempty"`
}

// RoomEventEnvelope is the canonical SSE room.event and /v0/rooms/:roomId/events envelope.
type RoomEventEnvelope struct {
	EventID    string          `json:"event_id"`
	TenantID   string          `json:"tenant_id"`
	RoomID     string          `json:"room_id"`
	RoomSeq    int64           `json:"room_seq"`
	EventType  string          `json:"event_type"`
	OccurredAt time.Time       `json:"occurred_at"`
	Actor      *ActorRef       `json:"actor,omitempty"`
	Payload    json.RawMessage `json:"payload"`
}

// RoomEventPage wraps GET /v0/rooms/:roomId/events.
type RoomEventPage struct {
	Items         []RoomEventEnvelope `json:"items"`
	HasMore       bool                `json:"has_more"`
	LatestRoomSeq int64               `json:"latest_room_seq"`
}

// RoomRunStatusAgentRef identifies the agent running inside a RoomRunStatus.
type RoomRunStatusAgentRef struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

// RoomRunStatus represents an active/completed/aborted Agent Run in a Room.
type RoomRunStatus struct {
	RunID        string                `json:"run_id"`
	RoomID       string                `json:"room_id"`
	Agent        RoomRunStatusAgentRef `json:"agent"`
	Status       string                `json:"status"` // "active" | "completed" | "aborted"
	EventOrdinal int64                 `json:"event_ordinal"`
	Replied      bool                  `json:"replied"`
	StopReason   *string               `json:"stop_reason,omitempty"`
	CreatedAt    time.Time             `json:"created_at"`
	UpdatedAt    time.Time             `json:"updated_at"`
}

// RoomRunStatusList wraps GET /v0/rooms/:roomId/run-statuses.
type RoomRunStatusList struct {
	Items []RoomRunStatus `json:"items"`
}

// RoomBackgroundTask represents a delegated background task running in a Room.
type RoomBackgroundTask struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Requirement string    `json:"requirement"`
	CreatedAt   time.Time `json:"created_at"`
}

// RoomBackgroundTaskList wraps GET /v0/rooms/:roomId/background-tasks.
type RoomBackgroundTaskList struct {
	Items []RoomBackgroundTask `json:"items"`
}

// RuntimePresentationEvent is a single persisted runtime presentation event
// returned by GET /v0/rooms/:roomId/runs/:runId/runtime-presentation-events.
type RuntimePresentationEvent struct {
	EventOrdinal int64           `json:"event_ordinal,omitempty"`
	Ordinal      int64           `json:"ordinal,omitempty"`
	Kind         string          `json:"kind,omitempty"`
	EventType    string          `json:"event_type,omitempty"`
	Type         string          `json:"type,omitempty"`
	Status       string          `json:"status,omitempty"`
	Title        string          `json:"title,omitempty"`
	Tool         string          `json:"tool,omitempty"`
	Summary      string          `json:"summary,omitempty"`
	OccurredAt   *time.Time      `json:"occurred_at,omitempty"`
	Raw          json.RawMessage `json:"-"`
}

// EffectiveOrdinal returns whichever ordinal field the server populated.
func (e RuntimePresentationEvent) EffectiveOrdinal() int64 {
	if e.EventOrdinal > 0 {
		return e.EventOrdinal
	}
	return e.Ordinal
}

// RuntimePresentationEventPage wraps GET /v0/rooms/:roomId/runs/:runId/runtime-presentation-events.
type RuntimePresentationEventPage struct {
	Items                   []json.RawMessage `json:"items"`
	PublishedThroughOrdinal int64             `json:"published_through_ordinal"`
	HasMore                 bool              `json:"has_more,omitempty"`
}

// RuntimePresentationRun summarizes one runtime presentation run.
type RuntimePresentationRun struct {
	RunID                   string          `json:"run_id"`
	Status                  string          `json:"status,omitempty"`
	PublishedThroughOrdinal int64           `json:"published_through_ordinal,omitempty"`
	Agent                   *ActorRef       `json:"agent,omitempty"`
	Raw                     json.RawMessage `json:"-"`
}

// RuntimePresentationRunList wraps GET /v0/rooms/:roomId/runtime-presentation-runs.
type RuntimePresentationRunList struct {
	Items []RuntimePresentationRun `json:"items"`
}

// MessageCardActorRef identifies the requester on a decision card.
type MessageCardActorRef struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"display_name"`
}

// DecisionAnswerValue represents an answer to one question in a Question card.
type DecisionAnswerValue struct {
	Selected []string `json:"selected,omitempty"`
	Text     *string  `json:"text,omitempty"`
}

// DecisionAnswer records the human's decision on a card.
type DecisionAnswer struct {
	Decision            string                         `json:"decision"`
	Comment             *string                        `json:"comment,omitempty"`
	ConnectionID        *string                        `json:"connection_id,omitempty"`
	Backend             *string                        `json:"backend,omitempty"`
	Answers             map[string]DecisionAnswerValue `json:"answers,omitempty"`
	AttachmentUploadIDs []string                       `json:"attachment_upload_ids,omitempty"`
	Links               []string                       `json:"links,omitempty"`
}

// DecisionRequest is sent to POST /v0/decisions/:decisionId.
type DecisionRequest struct {
	Decision            string                         `json:"decision"`
	ExpectedVersion     int64                          `json:"expected_version"`
	Comment             *string                        `json:"comment,omitempty"`
	ConnectionID        *string                        `json:"connection_id,omitempty"`
	Answers             map[string]DecisionAnswerValue `json:"answers,omitempty"`
	AttachmentUploadIDs []string                       `json:"attachment_upload_ids,omitempty"`
	Links               []string                       `json:"links,omitempty"`
}

// DecisionRequestedMessageCard represents any of the 12 interactive Linger decision card kinds.
type DecisionRequestedMessageCard struct {
	CardType           string               `json:"card_type"`
	DecisionID         string               `json:"decision_id"`
	Kind               string               `json:"kind"`
	Status             string               `json:"status"`
	Title              string               `json:"title"`
	Intent             string               `json:"intent"`
	Version            int64                `json:"version"`
	Requester          MessageCardActorRef  `json:"requester"`
	DecisionOwner      MessageCardActorRef  `json:"decision_owner"`
	DecidedBy          *MessageCardActorRef `json:"decided_by,omitempty"`
	DecidedAt          *time.Time           `json:"decided_at,omitempty"`
	ExpiresAt          *time.Time           `json:"expires_at,omitempty"`
	Outcome            *string              `json:"outcome,omitempty"`
	Answer             *DecisionAnswer      `json:"answer,omitempty"`
	AgentChange        json.RawMessage      `json:"agent_change,omitempty"`
	BrowserConnection  json.RawMessage      `json:"browser_connection,omitempty"`
	ComputerPermission json.RawMessage      `json:"computer_permission,omitempty"`
	ConnectionAuth     json.RawMessage      `json:"connection_auth,omitempty"`
	ConnectorWrite     json.RawMessage      `json:"connector_write,omitempty"`
	ProfileSetup       json.RawMessage      `json:"profile_setup,omitempty"`
	ProviderKey        json.RawMessage      `json:"provider_key,omitempty"`
	Question           json.RawMessage      `json:"question,omitempty"`
	RoomCreation       json.RawMessage      `json:"room_creation,omitempty"`
	RuntimePermission  json.RawMessage      `json:"runtime_permission,omitempty"`
	SearchKey          json.RawMessage      `json:"search_key,omitempty"`
}

// RoomActivityItem represents one Room's live activity summary from GET /v0/tenants/:tenantId/room-activity.
type RoomActivityItem struct {
	RoomID          string          `json:"room_id"`
	ActiveRuns      []RoomRunStatus `json:"active_runs,omitempty"`
	PendingCount    int             `json:"pending_decision_count,omitempty"`
	BackgroundCount int             `json:"background_task_count,omitempty"`
}

// TenantRoomActivity wraps GET /v0/tenants/:tenantId/room-activity.
type TenantRoomActivity struct {
	Items []RoomActivityItem `json:"items,omitempty"`
	Rooms []RoomActivityItem `json:"rooms,omitempty"`
}
