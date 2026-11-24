package api

import (
	"encoding/json"
	"time"
)

// --- Typed Views for All 12 TeamHub Decision Cards ---

type RuntimePermissionPage struct {
	URL        string  `json:"url"`
	Title      *string `json:"title,omitempty"`
	TargetName *string `json:"target_name,omitempty"`
	TargetRole *string `json:"target_role,omitempty"`
}

type RuntimePermissionScreenshot struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type RuntimePermissionScript struct {
	Path   string  `json:"path"`
	Body   string  `json:"body"`
	SHA256 *string `json:"sha256,omitempty"`
}

type RuntimePermissionDecisionView struct {
	Kind       string                       `json:"kind"` // "code" | "gui"
	Tool       string                       `json:"tool"`
	Title      string                       `json:"title"`
	Rationale  string                       `json:"rationale"`
	Input      string                       `json:"input"`
	Patch      *string                      `json:"patch,omitempty"`
	Page       *RuntimePermissionPage       `json:"page,omitempty"`
	Screenshot *RuntimePermissionScreenshot `json:"screenshot,omitempty"`
	Script     *RuntimePermissionScript     `json:"script,omitempty"`
}

type ConnectorConfirmationField struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type ConnectorConfirmationMessage struct {
	Format      string   `json:"format"`
	To          []string `json:"to,omitempty"`
	Cc          []string `json:"cc,omitempty"`
	Bcc         []string `json:"bcc,omitempty"`
	Subject     *string  `json:"subject,omitempty"`
	Destination *string  `json:"destination,omitempty"`
	Body        string   `json:"body"`
	Attachments []string `json:"attachments,omitempty"`
}

type ConnectorWriteDecisionView struct {
	Kind    string                        `json:"kind"` // "message" | "change"
	App     string                        `json:"app"`
	Account string                        `json:"account"`
	Tool    string                        `json:"tool"`
	Title   string                        `json:"title"`
	Input   string                        `json:"input"`
	Fields  []ConnectorConfirmationField  `json:"fields,omitempty"`
	Message *ConnectorConfirmationMessage `json:"message,omitempty"`
}

type DecisionQuestionOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type DecisionQuestion struct {
	ID      string                   `json:"id"`
	Prompt  string                   `json:"prompt"`
	Input   string                   `json:"input"` // "single_select" | "multi_select" | "text" (or radio/checkbox)
	Options []DecisionQuestionOption `json:"options"`
}

type QuestionDecisionView struct {
	Questions []DecisionQuestion `json:"questions"`
}

type AgentChangeConfirmationChange struct {
	Field  string  `json:"field"`
	Before *string `json:"before,omitempty"`
	After  string  `json:"after"`
}

type AgentChangeDecisionView struct {
	Action        string                          `json:"action"` // "create" | "update"
	AgentName     string                          `json:"agent_name"`
	TargetActorID *string                         `json:"target_actor_id,omitempty"`
	Changes       []AgentChangeConfirmationChange `json:"changes"`
}

type RoomCreationDecisionView struct {
	Name                   string           `json:"name"`
	Description            *string          `json:"description,omitempty"`
	MemberIDs              []string         `json:"member_ids"`
	OriginRoomID           string           `json:"origin_room_id"`
	CreatedRoomID          *string          `json:"created_room_id,omitempty"`
	InitialMessageSegments []MessageSegment `json:"initial_message_segments"`
}

type ConnectionAuthDecisionView struct {
	AppKey       string  `json:"app_key"`
	Account      *string `json:"account,omitempty"`
	ConnectionID *string `json:"connection_id,omitempty"`
}

type ProviderKeyDecisionView struct {
	AppKey *string `json:"app_key,omitempty"`
}

type SearchKeyDecisionView struct {
	Backend string `json:"backend"`
	Origin  string `json:"origin"`
	Reason  string `json:"reason"`
}

type BrowserConnectionDecisionView struct {
	ComputerID string `json:"computer_id"`
}

type ComputerPermissionDecisionView struct {
	ComputerID  string   `json:"computer_id"`
	Subject     string   `json:"subject"`
	Permissions []string `json:"permissions"`
	Reason      *string  `json:"reason,omitempty"`
}

type ProfileSetupDecisionView struct {
	Apps     []string `json:"apps,omitempty"`
	MoreApps []string `json:"more_apps,omitempty"`
}

// --- Mail Canvas ---

type MailCanvasState struct {
	To           string  `json:"to"`
	Subject      string  `json:"subject"`
	Body         string  `json:"body,omitempty"`
	Status       string  `json:"status"` // "draft" | "sending" | "sent" | "declined" | "failed"
	SourceDigest string  `json:"source_digest"`
	CanEdit      bool    `json:"can_edit"`
	MessageID    *string `json:"message_id,omitempty"`
	Error        *string `json:"error,omitempty"`
}

type SendMailCanvasRequest struct {
	ConnectionID string `json:"connection_id"`
	RequestID    string `json:"request_id"`
	SourceDigest string `json:"source_digest"`
}

// --- Room Attachments, Team.md & History Shares ---

type MessageAttachmentUpload struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	Filename  string    `json:"filename"`
	MediaType string    `json:"media_type"`
	SizeBytes int64     `json:"size_bytes"`
	SHA256    string    `json:"sha256"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type TeamMdParticipant struct {
	ActorID     string   `json:"actor_id"`
	Name        string   `json:"name"`
	Role        *string  `json:"role,omitempty"`
	ReceiveFrom []string `json:"receive_from"`
	ReportTo    []string `json:"report_to"`
}

type TeamMdDocument struct {
	CollaboratePattern string              `json:"collaborate_pattern"`
	TaskGoal           string              `json:"task_goal"`
	Orchestrator       TeamMdParticipant   `json:"orchestrator"`
	Members            []TeamMdParticipant `json:"members"`
	RawMarkdown        string              `json:"raw_markdown"`
	Revision           int64               `json:"revision"`
	UpdatedAt          time.Time           `json:"updated_at"`
}

type RoomHistoryShare struct {
	ID              string    `json:"id"`
	RoomName        string    `json:"room_name"`
	MessageCount    int       `json:"message_count"`
	SnapshotRoomSeq int64     `json:"snapshot_room_seq"`
	Revoked         bool      `json:"revoked"`
	Token           *string   `json:"token,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type RoomHistorySharePage struct {
	Items []RoomHistoryShare `json:"items"`
}

// --- Parsed Runtime Presentation Events ---

type AgentRuntimePlanStep struct {
	Content string `json:"content"`
	Status  string `json:"status"` // "pending" | "in_progress" | "completed"
}

type AgentRuntimeActivityContentBlock struct {
	Kind    string `json:"kind,omitempty"`
	Text    string `json:"text,omitempty"`
	Content string `json:"content,omitempty"`
	Code    string `json:"code,omitempty"`
	Lang    string `json:"language,omitempty"`
}

type AgentRuntimeExecutionFailure struct {
	Code           string  `json:"code"`
	RuntimeType    *string `json:"runtime_type,omitempty"`
	RuntimeVersion *string `json:"runtime_version,omitempty"`
}

// ParsedPresentationEvent unifies all 6 TeamHub AgentRuntime* persisted event kinds.
type ParsedPresentationEvent struct {
	Ordinal             int64
	Type                string // working_status_changed | stopped_status_changed | plan_updated | activity_started | activity_updated | activity_finished | presentation_output_created
	Status              string
	Outcome             string
	Title               string
	Kind                string
	ActivityID          string
	Detail              string
	Explanation         string
	Steps               []AgentRuntimePlanStep
	ContentBlocks       []AgentRuntimeActivityContentBlock
	OutputID            string
	OutputKind          string
	OutputText          string
	Continues           bool
	UnconfirmedInputIDs []string
	Failure             *AgentRuntimeExecutionFailure
	Raw                 json.RawMessage
}

// ParsePresentationEvent decodes a persisted RoomRunPresentationEventRecord
// (wrapping {event_ordinal, segment_id, message_id, event: {...}}) into a typed view.
func ParsePresentationEvent(ev RuntimePresentationEvent) ParsedPresentationEvent {
	out := ParsedPresentationEvent{
		Ordinal: ev.EffectiveOrdinal(),
		Type:    ev.Type,
		Status:  ev.Status,
		Title:   ev.Title,
		Kind:    ev.Kind,
		Raw:     ev.Raw,
	}
	if out.Type == "" {
		out.Type = ev.EventType
	}
	type innerWire struct {
		EventOrdinal        int64                              `json:"event_ordinal"`
		Ordinal             int64                              `json:"ordinal"`
		Type                string                             `json:"type"`
		EventType           string                             `json:"event_type"`
		Status              string                             `json:"status"`
		Outcome             string                             `json:"outcome"`
		Title               string                             `json:"title"`
		Summary             string                             `json:"summary"`
		Kind                string                             `json:"kind"`
		ActivityID          string                             `json:"activity_id"`
		Detail              string                             `json:"detail"`
		Explanation         string                             `json:"explanation"`
		Steps               []AgentRuntimePlanStep             `json:"steps"`
		Content             []AgentRuntimeActivityContentBlock `json:"content"`
		OutputID            string                             `json:"output_id"`
		OutputKind          string                             `json:"output_kind"`
		Text                string                             `json:"text"`
		Body                string                             `json:"body"`
		Continues           bool                               `json:"continues"`
		UnconfirmedInputIDs []string                           `json:"unconfirmed_input_ids"`
		Failure             *AgentRuntimeExecutionFailure      `json:"failure"`
	}

	// TeamHub wraps each item as {event_ordinal, segment_id, message_id?, event: {...}}.
	// Prefer the nested event payload when present; otherwise fall back to ev.Raw.
	payload := ev.Event
	if len(payload) == 0 && len(ev.Raw) > 0 {
		var env struct {
			EventOrdinal int64           `json:"event_ordinal"`
			Ordinal      int64           `json:"ordinal"`
			Event        json.RawMessage `json:"event"`
		}
		if json.Unmarshal(ev.Raw, &env) == nil {
			if env.EventOrdinal > 0 {
				out.Ordinal = env.EventOrdinal
			} else if env.Ordinal > 0 {
				out.Ordinal = env.Ordinal
			}
			if len(env.Event) > 0 && string(env.Event) != "null" {
				payload = env.Event
			}
		}
		if len(payload) == 0 {
			payload = ev.Raw
		}
	}
	if len(payload) == 0 {
		return out
	}

	var wire innerWire
	if json.Unmarshal(payload, &wire) == nil {
		if wire.EventOrdinal > 0 && out.Ordinal == 0 {
			out.Ordinal = wire.EventOrdinal
		} else if wire.Ordinal > 0 && out.Ordinal == 0 {
			out.Ordinal = wire.Ordinal
		}
		if wire.Type != "" {
			out.Type = wire.Type
		} else if wire.EventType != "" {
			out.Type = wire.EventType
		}
		if wire.Status != "" {
			out.Status = wire.Status
		}
		out.Outcome = wire.Outcome
		if wire.Title != "" {
			out.Title = wire.Title
		} else if wire.Summary != "" {
			out.Title = wire.Summary
		}
		if wire.Kind != "" {
			out.Kind = wire.Kind
		}
		out.ActivityID = wire.ActivityID
		out.Detail = wire.Detail
		out.Explanation = wire.Explanation
		out.Steps = wire.Steps
		out.ContentBlocks = wire.Content
		out.OutputID = wire.OutputID
		out.OutputKind = wire.OutputKind
		if wire.Text != "" {
			out.OutputText = wire.Text
		} else if wire.Body != "" {
			out.OutputText = wire.Body
		}
		out.Continues = wire.Continues
		out.UnconfirmedInputIDs = wire.UnconfirmedInputIDs
		out.Failure = wire.Failure
	}
	return out
}

// --- Agent Availability, Permissions, Browser Connection & BYOK ---

type TenantAgentCurrentActivity struct {
	Summary string `json:"summary,omitempty"`
	RoomID  string `json:"room_id,omitempty"`
}

type TenantAgentAvailability struct {
	Status          string                      `json:"status"`
	Label           string                      `json:"label"`
	Reason          *string                     `json:"reason,omitempty"`
	ActiveTaskCount int64                       `json:"active_task_count"`
	CurrentActivity *TenantAgentCurrentActivity `json:"current_activity,omitempty"`
}

type TenantAgentAvailabilitySnapshot struct {
	ActorID      string                  `json:"actor_id"`
	Availability TenantAgentAvailability `json:"availability"`
}

type TenantAgentAvailabilityPage struct {
	Items []TenantAgentAvailabilitySnapshot `json:"items"`
	Page  PageMeta                          `json:"page"`
}

type ComputerPermissionEntry struct {
	ID               string `json:"id"`
	State            string `json:"state"`
	Prompt           string `json:"prompt"`
	RelaunchRequired bool   `json:"relaunch_required"`
}

type ComputerPermissionSubjectStatus struct {
	Subject     string                    `json:"subject"`
	Permissions []ComputerPermissionEntry `json:"permissions"`
}

type ComputerPermissionStatus struct {
	Host     string                            `json:"host"`
	Platform string                            `json:"platform"`
	Subjects []ComputerPermissionSubjectStatus `json:"subjects"`
}

type BrowserConnectionStatus struct {
	Mode         string     `json:"mode"`
	Platform     string     `json:"platform"`
	State        string     `json:"state"`
	Browser      *string    `json:"browser,omitempty"`
	Profile      *string    `json:"profile,omitempty"`
	Message      *string    `json:"message,omitempty"`
	ConfiguredAt *time.Time `json:"configured_at,omitempty"`
	VerifiedAt   *time.Time `json:"verified_at,omitempty"`
}

type ByokInput struct {
	BaseURL       string  `json:"base_url"`
	Path          string  `json:"path"`
	Endpoint      string  `json:"endpoint"`
	Protocol      string  `json:"protocol"`
	ModelID       string  `json:"model_id"`
	APIKey        *string `json:"api_key,omitempty"`
	ReuseSavedKey *bool   `json:"reuse_saved_key,omitempty"`
	ContextWindow *int    `json:"context_window,omitempty"`
}

type ByokTestResult struct {
	Ok            bool   `json:"ok"`
	ModelID       string `json:"model_id"`
	Protocol      string `json:"protocol"`
	URL           string `json:"url"`
	ContextWindow int    `json:"context_window"`
}

type ByokModel struct {
	ID            string  `json:"id"`
	Name          *string `json:"name,omitempty"`
	ContextWindow *int    `json:"context_window,omitempty"`
}

type ByokModelList struct {
	Models []ByokModel `json:"models"`
	URL    string      `json:"url"`
}
