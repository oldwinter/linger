package api

import (
	"encoding/json"
	"time"
)

// --- Agents, Skills, Templates, Local Computers, Local Models & BYOK ---

type AgentRuntimePlacement struct {
	ComputerID  *string `json:"computer_id,omitempty"`
	RuntimeType string  `json:"runtime_type,omitempty"`
}

type AgentRuntimeConfig struct {
	Placement       *AgentRuntimePlacement `json:"placement,omitempty"`
	Model           string                 `json:"model,omitempty"`
	ReasoningEffort *string                `json:"reasoning_effort,omitempty"`
}

type AgentSkillRegistration struct {
	SkillID         string `json:"skill_id"`
	ManifestVersion string `json:"manifest_version,omitempty"`
	Enabled         bool   `json:"enabled"`
}

type TenantAgent struct {
	Actor                 Actor                    `json:"actor"`
	AgentManagementID     string                   `json:"agent_management_id"`
	AgentType             string                   `json:"agent_type"`
	AvatarImageURL        *string                  `json:"avatar_image_url,omitempty"`
	AvatarKey             *string                  `json:"avatar_key,omitempty"`
	ConfigurationRevision int64                    `json:"configuration_revision"`
	Description           string                   `json:"description"`
	Instructions          string                   `json:"instructions"`
	Runtime               AgentRuntimeConfig       `json:"runtime"`
	SkillBindings         []AgentSkillRegistration `json:"skill_bindings"`
	VisibilityScope       string                   `json:"visibility_scope"`
	CreatedBy             ActorRef                 `json:"created_by"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
}

type TenantAgentPage struct {
	Items []TenantAgent `json:"items"`
	Page  PageMeta      `json:"page"`
}

type SkillManifest struct {
	SkillID         string         `json:"skill_id"`
	TenantID        string         `json:"tenant_id"`
	Name            string         `json:"name"`
	PackageName     string         `json:"package_name"`
	Description     string         `json:"description"`
	ManifestVersion string         `json:"manifest_version"`
	AccessScope     string         `json:"access_scope"`
	Availability    string         `json:"availability"`
	FileCount       int            `json:"file_count"`
	SizeBytes       int64          `json:"size_bytes"`
	PackageSHA256   string         `json:"package_sha256"`
	ConfigSchema    map[string]any `json:"config_schema,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

type SkillManifestPage struct {
	Items []SkillManifest `json:"items"`
	Page  PageMeta        `json:"page"`
}

type AgentSkillBinding struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	AgentActorID   string         `json:"agent_actor_id"`
	BindingVersion int64          `json:"binding_version"`
	Enabled        bool           `json:"enabled"`
	Config         map[string]any `json:"config,omitempty"`
	Skill          struct {
		SkillID         string `json:"skill_id"`
		Name            string `json:"name,omitempty"`
		ManifestVersion string `json:"manifest_version,omitempty"`
	} `json:"skill"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AgentTemplate struct {
	TemplateID        string                   `json:"template_id"`
	Name              string                   `json:"name"`
	Description       string                   `json:"description"`
	Instructions      string                   `json:"instructions"`
	Origin            string                   `json:"origin"`
	AvatarKey         *string                  `json:"avatar_key,omitempty"`
	ConnectorBindings []string                 `json:"connector_bindings"`
	SkillBindings     []AgentSkillRegistration `json:"skill_bindings"`
	PublishedBy       *ActorRef                `json:"published_by,omitempty"`
	CreatedAt         time.Time                `json:"created_at"`
	UpdatedAt         time.Time                `json:"updated_at"`
}

type AgentTemplatePage struct {
	Items []AgentTemplate `json:"items"`
}

type AgentSkillBindingPutRequest struct {
	Config                 map[string]any `json:"config"`
	Enabled                bool           `json:"enabled"`
	ExpectedBindingVersion int64          `json:"expected_binding_version"`
	ManifestVersion        string         `json:"manifest_version"`
	ReplaceSkillID         *string        `json:"replace_skill_id,omitempty"`
}

type AgentModel struct {
	ID                     string   `json:"id"`
	Label                  string   `json:"label"`
	IsDefault              *bool    `json:"is_default,omitempty"`
	AllowedReasoningEffort []string `json:"allowed_reasoning_effort,omitempty"`
	DefaultReasoningEffort *string  `json:"default_reasoning_effort,omitempty"`
}

type LocalComputerRuntime struct {
	Type      string       `json:"type"`
	Status    string       `json:"status"`
	Version   *string      `json:"version,omitempty"`
	Models    []AgentModel `json:"models"`
	ErrorCode *string      `json:"error_code,omitempty"`
	Message   *string      `json:"message,omitempty"`
}

type LocalComputerWorkspaceGrant struct {
	Path string `json:"path"`
	Mode string `json:"mode,omitempty"`
}

type LocalComputer struct {
	ComputerID         string                        `json:"computer_id"`
	DisplayName        string                        `json:"display_name"`
	Status             string                        `json:"status"`
	Platform           *string                       `json:"platform,omitempty"`
	DaemonVersion      *string                       `json:"daemon_version,omitempty"`
	RecommendedVersion *string                       `json:"recommended_version,omitempty"`
	UpgradeRequired    bool                          `json:"upgrade_required"`
	ActiveOperations   int                           `json:"active_operations"`
	Capacity           *int                          `json:"capacity,omitempty"`
	AvailableCapacity  *int                          `json:"available_capacity,omitempty"`
	LastSeenAt         *time.Time                    `json:"last_seen_at,omitempty"`
	Runtimes           []LocalComputerRuntime        `json:"runtimes"`
	WorkspaceGrants    []LocalComputerWorkspaceGrant `json:"workspace_grants"`
}

type LocalComputerPage struct {
	Items []LocalComputer `json:"items"`
}

type LocalModelDownloadProgress struct {
	DoneBytes      int64  `json:"done_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
	Step           string `json:"step,omitempty"`
	BytesPerSecond *int64 `json:"bytes_per_second,omitempty"`
}

type LocalModelError struct {
	Code   string  `json:"code"`
	Detail *string `json:"detail,omitempty"`
	Cause  *string `json:"cause,omitempty"`
	Path   *string `json:"path,omitempty"`
}

type LocalModelAvailabilityReason struct {
	Code             string   `json:"code"`
	DetectedCuda     *string  `json:"detected_cuda,omitempty"`
	DetectedGlibc    *string  `json:"detected_glibc,omitempty"`
	DriverVersion    *string  `json:"driver_version,omitempty"`
	GpuVendor        *string  `json:"gpu_vendor,omitempty"`
	HaveBytes        *int64   `json:"have_bytes,omitempty"`
	MemoryKind       *string  `json:"memory_kind,omitempty"`
	MissingLibraries []string `json:"missing_libraries,omitempty"`
	NeedBytes        *int64   `json:"need_bytes,omitempty"`
	RequiredCuda     *string  `json:"required_cuda,omitempty"`
	RequiredGlibc    *string  `json:"required_glibc,omitempty"`
}

type LocalModelAvailability struct {
	Downloadable bool                          `json:"downloadable"`
	Reason       *LocalModelAvailabilityReason `json:"reason,omitempty"`
}

type LocalModelsViewUnavailableReason struct {
	Code   string  `json:"code"`
	Detail *string `json:"detail,omitempty"`
}

type LocalModelPool struct {
	ID         string            `json:"id"`
	Kind       string            `json:"kind,omitempty"`
	GpuIndex   *int              `json:"gpu_index,omitempty"`
	Label      string            `json:"label,omitempty"`
	TotalBytes int64             `json:"total_bytes"`
	UsedBytes  int64             `json:"used_bytes"`
	Holders    []json.RawMessage `json:"holders,omitempty"`
}

type LocalModel struct {
	ID                    string                      `json:"id"`
	Name                  string                      `json:"name"`
	Description           string                      `json:"description"`
	Quant                 string                      `json:"quant"`
	Fit                   string                      `json:"fit"`
	State                 string                      `json:"state"` // "absent" | "idle" | "loading" | "loaded" | "downloading"
	Parameters            *string                     `json:"parameters,omitempty"`
	ActiveParameters      *string                     `json:"active_parameters,omitempty"`
	Publisher             *string                     `json:"publisher,omitempty"`
	Family                *string                     `json:"family,omitempty"`
	Pool                  *string                     `json:"pool,omitempty"`
	PiModel               *string                     `json:"pi_model,omitempty"`
	ContextTokens         int64                       `json:"context_tokens"`
	DownloadBytes         int64                       `json:"download_bytes"`
	MemoryBytes           int64                       `json:"memory_bytes"`
	Vision                bool                        `json:"vision"`
	Recommended           bool                        `json:"recommended"`
	TokensPerSecond       *float32                    `json:"tokens_per_second,omitempty"`
	PromptTokensPerSecond *float32                    `json:"prompt_tokens_per_second,omitempty"`
	Availability          LocalModelAvailability      `json:"availability"`
	Download              *LocalModelDownloadProgress `json:"download,omitempty"`
	Error                 *LocalModelError            `json:"error,omitempty"`
}

type LocalModelUser struct {
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
}

type LocalModelView struct {
	Model  LocalModel       `json:"model"`
	UsedBy []LocalModelUser `json:"used_by"`
}

type LocalModelsComputer struct {
	ComputerID  string          `json:"computer_id"`
	DisplayName string          `json:"display_name"`
	Status      string          `json:"status"`
	Host        json.RawMessage `json:"host,omitempty"`
	LastSeenAt  *time.Time      `json:"last_seen_at,omitempty"`
}

type LocalModelsView struct {
	Available     bool                              `json:"available"`
	Computer      LocalModelsComputer               `json:"computer"`
	Models        []LocalModelView                  `json:"models"`
	Pools         []LocalModelPool                  `json:"pools"`
	Reason        *LocalModelsViewUnavailableReason `json:"reason,omitempty"`
	ToolVersion   *string                           `json:"tool_version,omitempty"`
	ObservedAt    *time.Time                        `json:"observed_at,omitempty"`
	ViewerIsOwner bool                              `json:"viewer_is_owner"`
}

type ByokSummary struct {
	Configured    bool    `json:"configured"`
	KeySaved      bool    `json:"key_saved"`
	BaseURL       *string `json:"base_url,omitempty"`
	Path          *string `json:"path,omitempty"`
	Endpoint      *string `json:"endpoint,omitempty"`
	Protocol      *string `json:"protocol,omitempty"`
	ModelID       *string `json:"model_id,omitempty"`
	ContextWindow *int    `json:"context_window,omitempty"`
}

type ModelSourceStatus struct {
	Mode            string      `json:"mode"`
	Runtime         string      `json:"runtime"`
	RuntimeModel    string      `json:"runtime_model"`
	ReasoningEffort *string     `json:"reasoning_effort,omitempty"`
	GatewayURL      *string     `json:"gateway_url,omitempty"`
	Byok            ByokSummary `json:"byok"`
}

type ModelSourceView struct {
	ComputerID         string             `json:"computer_id"`
	Online             bool               `json:"online"`
	Status             *ModelSourceStatus `json:"status,omitempty"`
	UpdatedAgentCount  *int               `json:"updated_agent_count,omitempty"`
	TerminatedRunCount *int               `json:"terminated_run_count,omitempty"`
	ViewerIsOwner      bool               `json:"viewer_is_owner"`
}

type ModelSourceSwitchRequest struct {
	Mode           string     `json:"mode"`
	Runtime        *string    `json:"runtime,omitempty"`
	Byok           *ByokInput `json:"byok,omitempty"`
	LocalModelID   *string    `json:"local_model_id,omitempty"`
	ForceTerminate *bool      `json:"force_terminate,omitempty"`
}

// --- Work Items, Tasks, Routines, Pocket Notes & Proactive Rules ---

type WorkItemAssignment struct {
	Actor      ActorRef  `json:"actor"`
	AssignedAt time.Time `json:"assigned_at"`
}

type WorkItemTaskExecutionSummary struct {
	TaskID string `json:"task_id,omitempty"`
	Status string `json:"status"`
}

type WorkItem struct {
	ID              string                        `json:"id"`
	TenantID        string                        `json:"tenant_id"`
	Number          int64                         `json:"number"`
	Kind            string                        `json:"kind"`
	Title           string                        `json:"title"`
	Description     string                        `json:"description"`
	State           string                        `json:"state"`
	Priority        string                        `json:"priority"`
	Resolution      *string                       `json:"resolution,omitempty"`
	Version         int64                         `json:"version"`
	OriginRoomID    *string                       `json:"origin_room_id,omitempty"`
	OriginMessageID *string                       `json:"origin_message_id,omitempty"`
	WorkRoomID      *string                       `json:"work_room_id,omitempty"`
	Assignees       []WorkItemAssignment          `json:"assignees"`
	CreatedBy       ActorRef                      `json:"created_by"`
	UpdatedBy       ActorRef                      `json:"updated_by"`
	TaskExecution   *WorkItemTaskExecutionSummary `json:"task_execution,omitempty"`
	ArchivedAt      *time.Time                    `json:"archived_at,omitempty"`
	CreatedAt       time.Time                     `json:"created_at"`
	UpdatedAt       time.Time                     `json:"updated_at"`
}

type WorkItemPage struct {
	Items []WorkItem `json:"items"`
	Page  PageMeta   `json:"page"`
}

type WorkItemComment struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"tenant_id"`
	WorkItemID string     `json:"work_item_id"`
	Author     ActorRef   `json:"author"`
	Body       string     `json:"body"`
	Version    int64      `json:"version"`
	DeletedAt  *time.Time `json:"deleted_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type WorkItemCommentPage struct {
	Items []WorkItemComment `json:"items"`
	Page  PageMeta          `json:"page"`
}

type TaskExecutionProjection struct {
	TaskID                 string          `json:"task_id"`
	Status                 string          `json:"status"`
	DesiredControl         string          `json:"desired_control"`
	Generation             int64           `json:"generation"`
	ExecutionRevision      int64           `json:"execution_revision"`
	ControlRevision        int64           `json:"control_revision"`
	ControlSettledRevision int64           `json:"control_settled_revision"`
	ReasonCode             *string         `json:"reason_code,omitempty"`
	ExecutionUpdatedAt     time.Time       `json:"execution_updated_at"`
	RunSpec                json.RawMessage `json:"run_spec,omitempty"`
}

type Routine struct {
	ID               string          `json:"id"`
	RoomID           string          `json:"room_id"`
	Name             string          `json:"name"`
	Instruction      string          `json:"instruction"`
	Enabled          bool            `json:"enabled"`
	Revision         int64           `json:"revision"`
	MentionActorID   *string         `json:"mention_actor_id,omitempty"`
	Cadence          json.RawMessage `json:"cadence,omitempty"`
	Listener         json.RawMessage `json:"listener,omitempty"`
	NextRunAt        *time.Time      `json:"next_run_at,omitempty"`
	CreatedByActorID string          `json:"created_by_actor_id"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type RoutineList struct {
	Items []Routine `json:"items"`
}

type PocketNote struct {
	NoteDate  string    `json:"date"`
	Body      string    `json:"text"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PocketNotePage struct {
	Today string       `json:"today"`
	Items []PocketNote `json:"items"`
	Page  PageMeta     `json:"page"`
}

type ProactiveRule struct {
	ID         string     `json:"id"`
	Text       string     `json:"text"`
	Status     string     `json:"status"`  // "active" | "shadow"
	Source     string     `json:"source"`  // "learned" | "user"
	Mandate    string     `json:"mandate"` // "remind" | ...
	Pinned     bool       `json:"pinned"`
	PromotedAt *time.Time `json:"promoted_at,omitempty"`
}

type ProactiveRuleBook struct {
	Version     int               `json:"version"`
	Rules       []ProactiveRule   `json:"rules"`
	Clues       []json.RawMessage `json:"clues,omitempty"`
	Divergences []json.RawMessage `json:"divergences,omitempty"`
	Mandates    []json.RawMessage `json:"mandates,omitempty"`
}

// --- Library, Documents, Wiki, Profile, Memory, Search ---

type Document struct {
	ID                   string    `json:"id"`
	TenantID             string    `json:"tenant_id"`
	Title                string    `json:"title"`
	Format               string    `json:"format"`
	RepresentationFormat string    `json:"representation_format"`
	Status               string    `json:"status"`
	CanEditNativeContent bool      `json:"can_edit_native_content"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type DocumentPage struct {
	Items []Document `json:"items"`
	Page  PageMeta   `json:"page"`
}

type DocumentVersion struct {
	ID                   string    `json:"id"`
	DocumentID           string    `json:"document_id"`
	VersionNumber        int       `json:"version_number"`
	Filename             string    `json:"filename"`
	MediaType            string    `json:"media_type"`
	RepresentationFormat string    `json:"representation_format"`
	SizeBytes            int64     `json:"size_bytes"`
	SHA256               string    `json:"sha256"`
	Source               string    `json:"source"`
	CreatedAt            time.Time `json:"created_at"`
}

type DocumentVersionList struct {
	Items []DocumentVersion `json:"items"`
}

type DocumentComment struct {
	ID        string    `json:"id"`
	Body      string    `json:"body"`
	Author    ActorRef  `json:"author"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DocumentCommentThread struct {
	ID           string            `json:"id"`
	DocumentID   string            `json:"document_id"`
	AnchorStatus string            `json:"anchor_status"`
	Resolved     bool              `json:"resolved"`
	CreatedBy    ActorRef          `json:"created_by"`
	Comments     []DocumentComment `json:"comments"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

type DocumentCommentThreadList struct {
	Items []DocumentCommentThread `json:"items"`
}

type PersonalWiki struct {
	ID                  *string    `json:"id,omitempty"`
	TenantID            string     `json:"tenant_id"`
	OwnerActorID        string     `json:"owner_actor_id"`
	State               string     `json:"state"`
	PublishedGeneration int64      `json:"published_generation"`
	CurrentRevisionID   *string    `json:"current_revision_id,omitempty"`
	LatestRefreshID     *string    `json:"latest_refresh_id,omitempty"`
	PreviewRevision     *int64     `json:"preview_revision,omitempty"`
	FailureReason       *string    `json:"failure_reason,omitempty"`
	CreatedAt           *time.Time `json:"created_at,omitempty"`
	UpdatedAt           *time.Time `json:"updated_at,omitempty"`
}

type PersonalProfileRevision struct {
	ID        string          `json:"id,omitempty"`
	Revision  int64           `json:"revision,omitempty"`
	Summary   string          `json:"summary,omitempty"`
	Modules   json.RawMessage `json:"modules,omitempty"`
	CreatedAt *time.Time      `json:"created_at,omitempty"`
}

type PersonalProfile struct {
	BuildingSince *time.Time                `json:"building_since,omitempty"`
	Current       *PersonalProfileRevision  `json:"current,omitempty"`
	History       []PersonalProfileRevision `json:"history"`
	HasMore       bool                      `json:"has_more"`
}

type PersonalMemoryEntry struct {
	ID        string    `json:"id"`
	Title     string    `json:"title,omitempty"`
	Summary   string    `json:"summary,omitempty"`
	Content   string    `json:"content,omitempty"`
	Kind      string    `json:"kind,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PersonalMemoryPage struct {
	Items []PersonalMemoryEntry `json:"items"`
	Page  PageMeta              `json:"page"`
}

type PersonalInsight struct {
	ID        string    `json:"id"`
	Dimension string    `json:"dimension"`
	Statement string    `json:"statement"`
	CreatedAt time.Time `json:"created_at"`
}

type PersonalInsightList struct {
	Items []PersonalInsight `json:"items"`
}

type MessageSearchRoom struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type MessageSearchHit struct {
	Message Message           `json:"message"`
	Room    MessageSearchRoom `json:"room"`
}

type MessageSearchPage struct {
	Items []MessageSearchHit `json:"items"`
	Page  PageMeta           `json:"page"`
}

// --- Voice, External Apps & Web Search ---

type VoiceProviderKeyStatus struct {
	Configured bool    `json:"configured"`
	Source     *string `json:"source,omitempty"`
}

type VoiceMediaPolicy struct {
	ActiveRoomID        *string                 `json:"active_room_id,omitempty"`
	VoiceAvailable      *bool                   `json:"voice_available,omitempty"`
	VoiceMediaSupported bool                    `json:"voice_media_supported"`
	LiveEnabled         *bool                   `json:"live_enabled,omitempty"`
	LiveSupported       *bool                   `json:"live_supported,omitempty"`
	SonioxKey           *VoiceProviderKeyStatus `json:"soniox_key,omitempty"`
	XaiKey              *VoiceProviderKeyStatus `json:"xai_key,omitempty"`
}

type VoiceSession struct {
	ID                   string     `json:"id"`
	TenantID             string     `json:"tenant_id"`
	RoomID               string     `json:"room_id"`
	Purpose              string     `json:"purpose"`
	Status               string     `json:"status"`
	CredentialGeneration int64      `json:"credential_generation,omitempty"`
	InputReadyGeneration int64      `json:"input_ready_generation,omitempty"`
	InputStartedOffsetMs *int64     `json:"input_started_offset_ms,omitempty"`
	InputEndedOffsetMs   *int64     `json:"input_ended_offset_ms,omitempty"`
	PartialTranscript    *string    `json:"partial_transcript,omitempty"`
	PartialStartOffsetMs *int64     `json:"partial_start_offset_ms,omitempty"`
	PartialEndOffsetMs   *int64     `json:"partial_end_offset_ms,omitempty"`
	LastFailureCode      *string    `json:"last_failure_code,omitempty"`
	CreatedByActorID     string     `json:"created_by_actor_id"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
	ClosedAt             *time.Time `json:"closed_at,omitempty"`
}

type VoiceCapture struct {
	ID                          string          `json:"id"`
	VoiceSessionID              string          `json:"voice_session_id"`
	RoomID                      string          `json:"room_id"`
	Status                      string          `json:"status"`
	RequestedStartOffsetMs      int64           `json:"requested_start_offset_ms"`
	ArchivedThroughMs           *int64          `json:"archived_through_ms,omitempty"`
	AudioDocumentVersionID      *string         `json:"audio_document_version_id,omitempty"`
	TranscriptDocumentVersionID *string         `json:"transcript_document_version_id,omitempty"`
	QuickNotes                  json.RawMessage `json:"quick_notes,omitempty"`
	TranscriptRecoveryStatus    *string         `json:"transcript_recovery_status,omitempty"`
	GapCount                    int64           `json:"gap_count"`
	GapDurationMs               int64           `json:"gap_duration_ms"`
	LastFailureCode             *string         `json:"last_failure_code,omitempty"`
	CreatedAt                   time.Time       `json:"created_at"`
	UpdatedAt                   time.Time       `json:"updated_at"`
}

type VoiceCaptureQuestion struct {
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	Question       string    `json:"question"`
	Answer         string    `json:"answer"`
	Answered       bool      `json:"answered"`
	CutoffOffsetMs int64     `json:"cutoff_offset_ms"`
	TaskTitle      *string   `json:"task_title,omitempty"`
	SentMessageID  *string   `json:"sent_message_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type VoiceCaptureQuestionList struct {
	Items []VoiceCaptureQuestion `json:"items"`
}

type VoiceTranscriptEvent struct {
	ID               string    `json:"id"`
	EventID          string    `json:"event_id"`
	VoiceSessionID   string    `json:"voice_session_id"`
	CaptureSessionID *string   `json:"capture_session_id,omitempty"`
	Kind             string    `json:"kind"`
	Lane             string    `json:"lane"`
	MediaEpoch       int32     `json:"media_epoch"`
	SpeakerID        *string   `json:"speaker_id,omitempty"`
	StartOffsetMs    int64     `json:"start_offset_ms"`
	EndOffsetMs      int64     `json:"end_offset_ms"`
	Text             string    `json:"text"`
	AcceptedAt       time.Time `json:"accepted_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type VoiceEvent struct {
	Kind       string                `json:"kind"`
	Session    *VoiceSession         `json:"session,omitempty"`
	Capture    *VoiceCapture         `json:"capture,omitempty"`
	Transcript *VoiceTranscriptEvent `json:"transcript,omitempty"`
}

type VoiceEventPage struct {
	Items      []VoiceEvent `json:"items"`
	HasMore    bool         `json:"has_more"`
	NextCursor string       `json:"next_cursor"`
}

type VoiceTranscriptEventPage struct {
	Items                []VoiceTranscriptEvent `json:"items"`
	EventCursor          *string                `json:"event_cursor,omitempty"`
	PartialTranscript    *string                `json:"partial_transcript,omitempty"`
	PartialStartOffsetMs *int64                 `json:"partial_start_offset_ms,omitempty"`
	PartialEndOffsetMs   *int64                 `json:"partial_end_offset_ms,omitempty"`
}

type ExternalApp struct {
	Key                       string   `json:"key"`
	DisplayName               string   `json:"display_name"`
	Description               string   `json:"description"`
	Availability              string   `json:"availability"`
	Capabilities              []string `json:"capabilities"`
	AllowsMultipleConnections bool     `json:"allows_multiple_connections"`
	LogoURL                   *string  `json:"logo_url,omitempty"`
}

type ExternalAppList struct {
	Apps               []ExternalApp `json:"apps"`
	ProviderConfigured bool          `json:"provider_configured"`
}

type ExternalConnection struct {
	ID            string    `json:"id"`
	Provider      string    `json:"provider"`
	Status        string    `json:"status"`
	IdentityLabel *string   `json:"identity_label,omitempty"`
	AutoReminders bool      `json:"auto_reminders"`
	ConnectURL    *string   `json:"connect_url,omitempty"`
	Revision      int64     `json:"revision"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type ExternalConnectionList struct {
	Connections []ExternalConnection `json:"connections"`
}

type WebSearchBackend struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Status           string   `json:"status"`
	Tier             string   `json:"tier"`
	KeyState         string   `json:"key_state"`
	Keyless          bool     `json:"keyless"`
	OfficialKeyCheck bool     `json:"official_key_check"`
	MaxLimit         int      `json:"max_limit"`
	MaxSites         int      `json:"max_sites"`
	Commands         []string `json:"commands"`
	Filters          []string `json:"filters"`
	FreeTier         *string  `json:"free_tier,omitempty"`
	KeyURL           *string  `json:"key_url,omitempty"`
	TierText         *string  `json:"tier_text,omitempty"`
}

type WebSearchBackendList struct {
	Backends            []WebSearchBackend `json:"backends"`
	CanSaveKeys         bool               `json:"can_save_keys"`
	DefaultSearch       string             `json:"default_search"`
	ChosenDefaultSearch *string            `json:"chosen_default_search,omitempty"`
	DefaultOpen         string             `json:"default_open"`
}
