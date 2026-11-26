package testutil

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/discovery"
)

// C2FakeServer provides full stateful API simulation for Tabs 3, 4, and 5
// (Work Items, Routines, Pocket Notes, Documents, Wiki/Graph, Memory/Voice,
// Proactive Rules, Profile/Insights, External Connections, Web Search, Voice Keys).
type C2FakeServer struct {
	Server      *httptest.Server
	URL         string
	TLS         bool
	Fingerprint string
	ShortCode   string

	mu         sync.Mutex
	ValidToken string
	DeviceID   string
	HostID     string
	HostName   string
	TenantID   string
	Identity   api.CurrentIdentity
	Actors     []api.Actor
	Rooms      []api.RoomListItem
	DirectRoom api.Room
	AnotherMe  api.Actor
	Messages   map[string][]api.Message
	NextSeq    int64

	// Work Items
	WorkItems         []api.WorkItem
	WorkItemComments  map[string][]api.WorkItemComment
	WorkItemTimeline  map[string][]api.WorkItemTimelineEntry
	TaskExecutions    map[string]api.TaskExecutionProjection
	TaskConversations map[string]api.TaskConversation
	TaskRuns          map[string]api.TaskRuntimePresentationRunPage

	// Routines
	RoutinesByRoom   map[string][]api.Routine
	RoutineSaveDelay time.Duration
	RoutineSaveGate  chan struct{}
	FailNextRoutine  string

	// Pocket Notes
	PocketNotes       []api.PocketNoteRecord
	FailPocketNotePut bool
	PocketPutCount    int

	// Library Documents
	Documents         []api.Document
	DocContents       map[string][]byte
	DocContentTypes   map[string]string
	DocVersions       map[string][]api.DocumentVersion
	DocHistory        map[string][]api.DocumentHistoryEntry
	DocCommentThreads map[string][]api.DocumentCommentThread
	DocLinkShares     map[string]api.DocumentLinkShare
	MyTree            api.DocumentTree
	SharedTree        api.DocumentTree
	RoomDocIDs        map[string][]string
	PreviewFiles      map[string]string

	// Wiki & Memory & Voice
	PersonalWiki     api.PersonalWiki
	WikiPreview      map[string]string
	WikiDocuments    []api.Document
	WikiGraph        api.WikiGraphData
	MemoryEntries    []api.PersonalMemoryEntryC2
	VoiceSession     api.VoiceSession
	VoiceCapture     api.VoiceCapture
	VoiceTranscripts []api.VoiceTranscriptEvent
	VoiceQuestions   []api.VoiceCaptureQuestion
	voiceSSESubs     map[chan SSEFrame]struct{}

	// Settings
	ProactiveRules    api.ProactiveRuleBookC2
	AccountProfile    api.AccountProfile
	PersonalProfile   api.PersonalProfileC2
	PersonalInsights  []api.PersonalInsight
	ExternalApps      api.ExternalAppList
	ExternalConns     []api.ExternalConnectionC2
	ConnAgentGrants   map[string][]api.ExternalConnectionAgentAccess
	WebSearch         api.WebSearchBackendList
	VoicePolicy       api.VoiceMediaPolicyC2
	SavedVoiceKeys    map[string]string
	SavedSearchKeys   map[string]string
	Requested         []string
	Unpaired          bool
	TokenRotatedCount int
}

// NewC2FakeServer starts a C2FakeServer with rich realistic fixtures.
func NewC2FakeServer(useTLS bool) (*C2FakeServer, error) {
	s := newC2FakeServerState(useTLS)

	srv := httptest.NewUnstartedServer(http.HandlerFunc(s.serveHTTP))
	if useTLS {
		cert, fp, err := generateSelfSignedECDSACert()
		if err != nil {
			return nil, err
		}
		s.Fingerprint = fp
		sc, err := discovery.ShortFingerprint(fp)
		if err != nil {
			return nil, err
		}
		s.ShortCode = sc
		srv.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{cert}}
		srv.StartTLS()
	} else {
		srv.Start()
	}
	s.Server = srv
	s.URL = srv.URL
	return s, nil
}

func newC2FakeServerState(useTLS bool) *C2FakeServer {
	now := time.Date(2026, 11, 24, 14, 0, 0, 0, time.UTC)
	human := api.ActorRef{ID: "act_human_1", TenantID: "ten_1", Kind: "human", DisplayName: "Alex Rivera"}
	agent := api.ActorRef{ID: "act_agent_1", TenantID: "ten_1", Kind: "agent", DisplayName: "Scout"}
	anotherMe := api.ActorRef{ID: "act_another_1", TenantID: "ten_1", Kind: "agent", DisplayName: "Another Me"}

	room1 := "room_general"
	room2 := "room_ops"
	workRoom := "room_work_12"
	taskID := "wi_12"
	sonioxSrc := "none"
	xaiSrc := "saved"
	voiceAvail := true
	liveEnabled := true
	seq1 := int64(1)
	seq2 := int64(2)

	codeSrc := "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Hello Linger\")\n}\n"
	mdSrc := "# Mobile Companion Architecture\n\n## Overview\n\nBuilt with **MyGo** and TLS 1.3 SPKI pinning.\n\n- Zero browser dependencies\n- Offline SQLite FTS5 search\n"
	htmlSrc := "<!doctype html><html><body><h1>Architecture Diagram</h1><p>Interactive preview.</p></body></html>"

	s := &C2FakeServer{
		TLS:        useTLS,
		ValidToken: "c2_test_token_001",
		DeviceID:   "dev_c2_01",
		HostID:     "host_studio_mac",
		HostName:   "Studio Mac",
		TenantID:   "ten_1",
		NextSeq:    100,
		Identity: api.CurrentIdentity{
			Account: api.Account{
				ID:          "acc_1",
				Email:       "alex@linger.dev",
				DisplayName: "Alex Rivera",
				CreatedAt:   now,
			},
			Actors: []api.Actor{
				{ID: human.ID, TenantID: "ten_1", Kind: "human", DisplayName: "Alex Rivera", CreatedAt: now},
				{ID: agent.ID, TenantID: "ten_1", Kind: "agent", DisplayName: "Scout", CreatedAt: now},
			},
		},
		Actors: []api.Actor{
			{ID: human.ID, TenantID: "ten_1", Kind: "human", DisplayName: "Alex Rivera", CreatedAt: now},
			{ID: agent.ID, TenantID: "ten_1", Kind: "agent", DisplayName: "Scout", CreatedAt: now},
			{ID: anotherMe.ID, TenantID: "ten_1", Kind: "agent", DisplayName: "Another Me", CreatedAt: now},
		},
		AnotherMe: api.Actor{ID: anotherMe.ID, TenantID: "ten_1", Kind: "agent", DisplayName: "Another Me", CreatedAt: now},
		DirectRoom: api.Room{
			ID:        "room_another_me",
			TenantID:  "ten_1",
			Kind:      "direct",
			Name:      "Another Me",
			CreatedBy: human,
			CreatedAt: now,
			UpdatedAt: now,
		},
		Rooms: []api.RoomListItem{
			{ID: room1, TenantID: "ten_1", Kind: "group", Name: "Product Launch", CreatedBy: human, LatestRoomSeq: 2, CreatedAt: now, UpdatedAt: now},
			{ID: room2, TenantID: "ten_1", Kind: "group", Name: "Release Ops", CreatedBy: human, LatestRoomSeq: 1, CreatedAt: now, UpdatedAt: now},
			{ID: workRoom, TenantID: "ten_1", Kind: "work", Name: "Task #12 Workspace", CreatedBy: human, LatestRoomSeq: 1, CreatedAt: now, UpdatedAt: now},
		},
		Messages: map[string][]api.Message{
			room1: {
				{
					ID: "msg_1", TenantID: "ten_1", RoomID: room1, RoomSeq: &seq1, Author: human,
					MessageKind: "conversation", RawMessage: "Let us verify the deployment checklist before release.",
					CreatedAt: now.Add(-30 * time.Minute),
				},
				{
					ID: "msg_2", TenantID: "ten_1", RoomID: room1, RoomSeq: &seq2, Author: agent,
					MessageKind: "conversation", RawMessage: "TLS pinning and FTS5 sync passed all checks.",
					CreatedAt: now.Add(-10 * time.Minute),
				},
			},
		},
		WorkItems: []api.WorkItem{
			{
				ID: taskID, TenantID: "ten_1", Number: 12, Kind: "task",
				Title: "Ship Mobile Companion Wave C-2", Description: "Implement Work, Library, and Settings tabs with offline support.",
				State: "in_progress", Priority: "high", Version: 2,
				OriginRoomID: &room1, WorkRoomID: &workRoom,
				Assignees: []api.WorkItemAssignment{{Actor: agent, AssignedAt: now}},
				CreatedBy: human, UpdatedBy: human,
				TaskExecution: &api.WorkItemTaskExecutionSummary{TaskID: taskID, Status: "running"},
				CreatedAt:     now.Add(-2 * time.Hour), UpdatedAt: now,
			},
			{
				ID: "wi_13", TenantID: "ten_1", Number: 13, Kind: "issue",
				Title: "Audit offline SQLite outbox retry", Description: "Ensure Pocket Notes survive offline restarts.",
				State: "open", Priority: "urgent", Version: 1,
				OriginRoomID: &room2,
				CreatedBy:    human, UpdatedBy: human,
				CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
			},
			{
				ID: "wi_11", TenantID: "ten_1", Number: 11, Kind: "issue",
				Title: "Configure Tailscale failover probe", Description: "Verify 1.5s LAN timeout switches cleanly.",
				State: "resolved", Priority: "medium", Version: 3,
				CreatedBy: human, UpdatedBy: human,
				CreatedAt: now.Add(-24 * time.Hour), UpdatedAt: now.Add(-2 * time.Hour),
			},
		},
		WorkItemComments: map[string][]api.WorkItemComment{
			taskID: {
				{
					ID: "wic_1", TenantID: "ten_1", WorkItemID: taskID,
					Author: agent, Body: "Started building the Work Item detail sheet.", Version: 1,
					CreatedAt: now.Add(-15 * time.Minute), UpdatedAt: now.Add(-15 * time.Minute),
				},
			},
		},
		WorkItemTimeline: map[string][]api.WorkItemTimelineEntry{
			taskID: {
				{
					Type: "activity",
					Activity: &api.WorkItemActivity{
						ID: "wia_1", WorkItemID: taskID, Kind: "state_transition", Actor: human,
						FromState: strPtr("open"), ToState: strPtr("in_progress"), OccurredAt: now.Add(-45 * time.Minute),
					},
				},
				{
					Type: "comment",
					Comment: &api.WorkItemComment{
						ID: "wic_1", TenantID: "ten_1", WorkItemID: taskID,
						Author: agent, Body: "Started building the Work Item detail sheet.", Version: 1,
						CreatedAt: now.Add(-15 * time.Minute), UpdatedAt: now.Add(-15 * time.Minute),
					},
				},
			},
		},
		TaskExecutions: map[string]api.TaskExecutionProjection{
			taskID: {
				TaskID: taskID, Status: "running", DesiredControl: "none",
				Generation: 1, ExecutionRevision: 3, ControlRevision: 1, ControlSettledRevision: 1,
				ExecutionUpdatedAt: now,
			},
		},
		TaskConversations: map[string]api.TaskConversation{
			taskID: {
				Inputs: []api.TaskConversationInput{
					{ID: "tci_1", Body: "Build Work, Library, and Settings screens.", Source: "delegation", Author: human, CreatedAt: now.Add(-40 * time.Minute)},
				},
				Cards: []api.TaskConversationCard{
					{DecisionID: "dec_task_1", RoomID: workRoom, MessageID: "msg_w_1", CreatedAt: now.Add(-20 * time.Minute)},
				},
			},
		},
		TaskRuns: map[string]api.TaskRuntimePresentationRunPage{
			taskID: {
				WorkRoomID: &workRoom,
				ActiveItems: []api.RoomRunStatus{
					{RunID: "run_task_1", RoomID: workRoom, Agent: api.RoomRunStatusAgentRef{ID: agent.ID, DisplayName: agent.DisplayName}, Status: "active", EventOrdinal: 4, CreatedAt: now, UpdatedAt: now},
				},
				HistoryItems: []api.RoomRunStatus{
					{RunID: "run_task_0", RoomID: workRoom, Agent: api.RoomRunStatusAgentRef{ID: agent.ID, DisplayName: agent.DisplayName}, Status: "completed", EventOrdinal: 9, Replied: true, CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-50 * time.Minute)},
				},
			},
		},
		RoutinesByRoom: map[string][]api.Routine{
			room1: {
				{
					ID: "rt_1", RoomID: room1, Name: "Morning Standup Digest",
					Instruction: "Summarize open Work Items and recent commits.",
					Enabled:     true, Revision: 1,
					Cadence:   json.RawMessage(`{"kind":"daily","timezone":"UTC","hour":9,"minute":0}`),
					NextRunAt: timePtr(now.Add(18 * time.Hour)), CreatedByActorID: human.ID,
					CreatedAt: now.Add(-72 * time.Hour), UpdatedAt: now.Add(-time.Hour),
				},
			},
			room2: {
				{
					ID: "rt_2", RoomID: room2, Name: "Release Health Check",
					Instruction: "Verify CI pipelines and mobile test results.",
					Enabled:     false, Revision: 2,
					Cadence:          json.RawMessage(`{"kind":"every_n_hours","timezone":"UTC","interval_hours":4}`),
					CreatedByActorID: human.ID,
					CreatedAt:        now.Add(-48 * time.Hour), UpdatedAt: now.Add(-2 * time.Hour),
				},
			},
		},
		PocketNotes: []api.PocketNoteRecord{
			{Date: "2026-11-24", Text: "Verify offline Pocket Note outbox drain on reconnect.", UpdatedAt: now},
			{Date: "2026-11-23", Text: "Yesterday: finished TLS SPKI pin verification.", UpdatedAt: now.Add(-24 * time.Hour)},
		},
		Documents: []api.Document{
			{
				ID: "doc_1", TenantID: "ten_1", Title: "Mobile Architecture.md", Format: "markdown",
				RepresentationFormat: "markdown", Status: "active", CanEditNativeContent: true,
				CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now,
			},
			{
				ID: "doc_2", TenantID: "ten_1", Title: "main.go", Format: "code",
				RepresentationFormat: "file", Status: "active", CanEditNativeContent: false,
				CreatedAt: now.Add(-24 * time.Hour), UpdatedAt: now.Add(-time.Hour),
			},
			{
				ID: "doc_3", TenantID: "ten_1", Title: "release-report.html", Format: "html",
				RepresentationFormat: "file", Status: "active", CanEditNativeContent: false,
				CreatedAt: now.Add(-12 * time.Hour), UpdatedAt: now.Add(-30 * time.Minute),
			},
		},
		DocContents: map[string][]byte{
			"doc_1": []byte(mdSrc),
			"doc_2": []byte(codeSrc),
			"doc_3": []byte(htmlSrc),
		},
		DocContentTypes: map[string]string{
			"doc_1": "text/markdown; charset=utf-8",
			"doc_2": "text/plain; charset=utf-8",
			"doc_3": "text/html; charset=utf-8",
		},
		DocVersions: map[string][]api.DocumentVersion{
			"doc_1": {{ID: "dv_1", DocumentID: "doc_1", VersionNumber: 1, Filename: "Mobile Architecture.md", MediaType: "text/markdown", RepresentationFormat: "markdown", SizeBytes: int64(len(mdSrc)), Source: "editor", CreatedAt: now}},
			"doc_2": {{ID: "dv_2", DocumentID: "doc_2", VersionNumber: 1, Filename: "main.go", MediaType: "text/plain", RepresentationFormat: "file", SizeBytes: int64(len(codeSrc)), Source: "upload", CreatedAt: now}},
			"doc_3": {{ID: "dv_3", DocumentID: "doc_3", VersionNumber: 1, Filename: "release-report.html", MediaType: "text/html", RepresentationFormat: "file", SizeBytes: int64(len(htmlSrc)), Source: "upload", CreatedAt: now}},
		},
		DocHistory: map[string][]api.DocumentHistoryEntry{
			"doc_1": {
				{ID: "dh_1", DocumentID: "doc_1", RevisionID: "rev_1", PersistedSeq: 4, Trigger: "checkpoint", CreatedBy: api.DocumentHistoryActor{ActorID: human.ID, DisplayName: human.DisplayName}, CreatedAt: now.Add(-time.Hour)},
			},
		},
		DocCommentThreads: map[string][]api.DocumentCommentThread{
			"doc_1": {
				{
					ID: "dct_1", DocumentID: "doc_1", AnchorStatus: "attached", Resolved: false, CreatedBy: human,
					Comments:  []api.DocumentComment{{ID: "dc_1", Body: "Should we add offline FTS5 notes here?", Author: human, CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-20 * time.Minute)}},
					CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-20 * time.Minute),
				},
			},
		},
		DocLinkShares: map[string]api.DocumentLinkShare{
			"doc_1": {ID: "dls_1", DocumentID: "doc_1", Role: "viewer", Status: "inactive", Version: 1},
		},
		RoomDocIDs: map[string][]string{
			room1: {"doc_1", "doc_2"},
		},
		PreviewFiles: map[string]string{},
		PersonalWiki: api.PersonalWiki{
			ID: strPtr("wiki_1"), TenantID: "ten_1", OwnerActorID: human.ID,
			State: "ready", PublishedGeneration: 5, UpdatedAt: &now,
		},
		WikiPreview: map[string]string{
			"projects/linger-mobile.md": "# Linger Mobile\n\nNative mobile companion built in Go.",
		},
		WikiDocuments: []api.Document{
			{ID: "doc_1", TenantID: "ten_1", Title: "projects/linger-mobile", Format: "markdown", RepresentationFormat: "markdown", Status: "active", CreatedAt: now, UpdatedAt: now},
		},
		WikiGraph: api.WikiGraphData{
			Root:  "Knowledge Graph",
			Types: []string{"Project", "Topic", "Session", "Contact"},
			Nodes: []api.WikiGraphNode{
				{ID: "projects/linger-mobile", Title: "Linger Mobile", Category: "Project", Description: "Native companion app", Body: "# Linger Mobile\n\nBuilt on MyGo UI.", Tags: []string{"mobile", "go"}, Links: []string{"topics/tls-pinning", "topics/offline-sync"}, Size: 1200},
				{ID: "topics/tls-pinning", Title: "TLS SPKI Pinning", Category: "Topic", Description: "Constant-time leaf pin", Body: "# TLS Pinning\n\nSHA-256 SPKI pin.", Tags: []string{"security"}, Backlinks: []string{"projects/linger-mobile"}, Size: 800},
				{ID: "topics/offline-sync", Title: "SQLite FTS5 Sync", Category: "Topic", Description: "Outbox durability", Body: "# Offline Sync\n\nFTS5 + outbox.", Tags: []string{"sqlite"}, Backlinks: []string{"projects/linger-mobile"}, Size: 900},
				{ID: "contacts/alex", Title: "Alex Rivera", Category: "Contact", Description: "Lead engineer", Body: "# Alex Rivera\n\nEngineering lead.", Tags: []string{"team"}, Links: []string{"projects/linger-mobile"}, Size: 500},
			},
			Edges: []api.WikiGraphEdge{
				{Source: "projects/linger-mobile", Target: "topics/tls-pinning", Strength: 0.9},
				{Source: "projects/linger-mobile", Target: "topics/offline-sync", Strength: 0.85},
				{Source: "contacts/alex", Target: "projects/linger-mobile", Kind: "mention", Strength: 0.6},
			},
		},
		MemoryEntries: []api.PersonalMemoryEntryC2{
			{
				ID: "mem_daily_1", Kind: "daily", Title: "Daily Journal 2026-11-24",
				Summary: "Completed Wave C-2 API types and offline Pocket Notes design.",
				Content: "# 2026-11-24\n\n- Verified TeamHub handler routes\n- Built FTS5 offline search",
				Date:    strPtr("2026-11-24"), Path: "timeline/daily/2026-11-24.md", UpdatedAt: now,
			},
			{
				ID: "mem_weekly_1", Kind: "weekly", Title: "Weekly Digest W47",
				Summary: "Shipped Companion Gateway and Connection Hub.",
				Content: "# Week 47\n\nStrong progress on mobile protocol client.",
				Path:    "timeline/weekly/2026-W47.md", UpdatedAt: now.Add(-24 * time.Hour),
			},
			{
				ID: "mem_meet_1", Kind: "meeting", Title: "Release Sync Meeting",
				Summary: "Discussed Wave C-2 QA gates and biometric lock fallback.",
				Content: "# Release Sync\n\nAgreed on 320px minimum viewport width.",
				Path:    "timeline/meetings/vc_1.md", UpdatedAt: now.Add(-2 * time.Hour),
				Meeting: &api.MemoryMeetingFiles{
					CaptureID:            "vc_1",
					StartedAt:            now.Add(-3 * time.Hour),
					RecordingDocumentID:  "doc_rec_1",
					RecordingVersionID:   "dv_rec_1",
					RecordingFilename:    "release-sync.ogg",
					TranscriptDocumentID: "doc_tr_1",
					TranscriptVersionID:  "dv_tr_1",
					SummaryReady:         true,
				},
			},
		},
		VoiceSession: api.VoiceSession{
			ID: "vs_1", TenantID: "ten_1", RoomID: room1, Purpose: "capture", Status: "active",
			CreatedByActorID: human.ID, CreatedAt: now, UpdatedAt: now,
		},
		VoiceCapture: api.VoiceCapture{
			ID: "vc_1", VoiceSessionID: "vs_1", RoomID: room1, Status: "recording",
			AudioDocumentVersionID: strPtr("dv_rec_1"),
			GapCount:               1, GapDurationMs: 1200, TranscriptRecoveryStatus: strPtr("needed"),
			CreatedAt: now, UpdatedAt: now,
		},
		VoiceTranscripts: []api.VoiceTranscriptEvent{
			{ID: "vt_1", EventID: "ve_1", VoiceSessionID: "vs_1", Kind: "final", Lane: "mic", Text: "Let us review the offline cache checklist.", StartOffsetMs: 1000, EndOffsetMs: 4200, AcceptedAt: now, UpdatedAt: now},
		},
		VoiceQuestions: []api.VoiceCaptureQuestion{
			{ID: "vq_1", Kind: "question", Question: "What viewport widths were agreed?", Answer: "320px, 390px, and 420px.", Answered: true, CutoffOffsetMs: 4200, CreatedAt: now},
		},
		voiceSSESubs: map[chan SSEFrame]struct{}{},
		ProactiveRules: api.ProactiveRuleBookC2{
			Version: 1,
			Rules: []api.ProactiveRule{
				{ID: "rule_1", Text: "Notify when CI fails on main", Status: "active", Source: "user", Mandate: "remind", Pinned: true},
				{ID: "rule_shadow_1", Text: "Create a task for urgent customer bug reports", Status: "shadow", Source: "learned", Mandate: "none", Pinned: false},
			},
			Divergences: []api.ProactiveShadowDivergence{
				{ID: "div_1", RuleID: "rule_shadow_1", GuidelineVersion: 1, Matter: "Customer reported crash on launch", TakenAction: "silent", ShadowAction: "track", CreatedAt: now},
			},
		},
		AccountProfile: api.AccountProfile{
			Name:         "Alex Rivera",
			Email:        "alex@linger.dev",
			Bio:          "Building Linger Mobile",
			Organization: "Linger Labs",
		},
		PersonalProfile: api.PersonalProfileC2{
			Current: &api.PersonalProfileRevisionC2{
				ID:            "ppr_1",
				TenantID:      "ten_1",
				PromptVersion: "v2",
				Markdown:      "## Working Style\n\nPrefers concise diffs and strict race-checked tests.",
				SourceApps:    []string{"github"},
				CreatedAt:     now,
			},
		},
		PersonalInsights: []api.PersonalInsight{
			{ID: "pi_1", Dimension: "communication", Statement: "Prefers bulleted engineering summaries.", CreatedAt: now},
			{ID: "pi_2", Dimension: "schedule", Statement: "Reviews pull requests between 09:00 and 11:00.", CreatedAt: now.Add(-time.Hour)},
		},
		ExternalApps: api.ExternalAppList{
			ProviderConfigured: true,
			Apps: []api.ExternalApp{
				{Key: "github", DisplayName: "GitHub", Description: "Repositories and pull requests", Availability: "available", Capabilities: []string{"read", "write"}},
				{Key: "slack", DisplayName: "Slack", Description: "Team messaging", Availability: "available", Capabilities: []string{"read"}},
			},
		},
		ExternalConns: []api.ExternalConnectionC2{
			{
				ID: "conn_1", Provider: "github", Status: "connected",
				IdentityLabel: strPtr("alex-rivera"), AutoReminders: true, Revision: 2,
				CreatedAt: now, UpdatedAt: now,
			},
		},
		ConnAgentGrants: map[string][]api.ExternalConnectionAgentAccess{
			"conn_1": {
				{AgentActorID: agent.ID, AgentManagementID: "am_1", AgentDisplayName: "Scout", TenantID: "ten_1", Granted: true, Revision: 1},
				{AgentActorID: anotherMe.ID, AgentManagementID: "am_2", AgentDisplayName: "Another Me", TenantID: "ten_1", Granted: false, Revision: 1},
			},
		},
		WebSearch: api.WebSearchBackendList{
			CanSaveKeys:   true,
			DefaultSearch: "duckduckgo",
			DefaultOpen:   "direct",
			Backends: []api.WebSearchBackend{
				{ID: "duckduckgo", Name: "DuckDuckGo", Description: "Keyless privacy search", Status: "ready", Tier: "free", KeyState: "not_required", Keyless: true},
				{ID: "tavily", Name: "Tavily", Description: "AI-optimized web search", Status: "needs_key", Tier: "paid", KeyState: "missing", Keyless: false},
			},
		},
		VoicePolicy: api.VoiceMediaPolicyC2{
			ActiveRoomID:        &room1,
			VoiceAvailable:      &voiceAvail,
			VoiceMediaSupported: true,
			LiveEnabled:         &liveEnabled,
			LiveSupported:       &liveEnabled,
			SonioxKey:           &api.VoiceProviderKeyStatusC2{Source: sonioxSrc, CanSave: true, Configured: false},
			XaiKey:              &api.VoiceProviderKeyStatusC2{Source: xaiSrc, CanSave: true, Configured: true},
		},
		SavedVoiceKeys:  map[string]string{},
		SavedSearchKeys: map[string]string{},
	}

	s.MyTree = api.DocumentTree{
		Items: []api.DocumentTreeNode{
			{ID: "fold_1", NodeKind: "folder", SortKey: "01", Name: "Engineering", CreatedAt: now, UpdatedAt: now},
			{ID: "place_1", NodeKind: "document", ParentID: strPtr("fold_1"), SortKey: "02", DocumentID: "doc_1", Document: &s.Documents[0], CreatedAt: now, UpdatedAt: now},
			{ID: "place_2", NodeKind: "document", SortKey: "03", DocumentID: "doc_2", Document: &s.Documents[1], CreatedAt: now, UpdatedAt: now},
			{ID: "place_3", NodeKind: "document", SortKey: "04", DocumentID: "doc_3", Document: &s.Documents[2], CreatedAt: now, UpdatedAt: now},
		},
	}
	s.SharedTree = api.DocumentTree{
		Items: []api.DocumentTreeNode{
			{ID: "splace_1", NodeKind: "document", SortKey: "01", DocumentID: "doc_1", Document: &s.Documents[0], CreatedAt: now, UpdatedAt: now},
		},
	}

	return s
}

// Close shuts down the test server and closes active voice SSE channels.
func (s *C2FakeServer) Close() {
	s.mu.Lock()
	for ch := range s.voiceSSESubs {
		close(ch)
		delete(s.voiceSSESubs, ch)
	}
	s.mu.Unlock()
	s.Server.Close()
}

// NewClient returns an authenticated api.Client connected to this C2FakeServer.
func (s *C2FakeServer) NewClient() (*api.Client, error) {
	return api.NewClient(api.ClientConfig{
		BaseURL:        s.URL,
		Mode:           api.AuthModeCompanion,
		Token:          s.ValidToken,
		TLSFingerprint: s.Fingerprint,
		AllowPlainHTTP: !s.TLS,
	})
}

// PushVoiceSSE pushes a live frame to active /v0/voice-sessions/:id/events/stream subscribers.
func (s *C2FakeServer) PushVoiceSSE(frame SSEFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.voiceSSESubs {
		select {
		case ch <- frame:
		default:
		}
	}
}

func (s *C2FakeServer) nextID(prefix string) string {
	s.NextSeq++
	return fmt.Sprintf("%s_%d", prefix, s.NextSeq)
}

func (s *C2FakeServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.Requested = append(s.Requested, r.Method+" "+r.URL.Path)
	tok := s.ValidToken
	s.mu.Unlock()

	if auth := r.Header.Get("Authorization"); auth != "Bearer "+tok {
		writeJSONError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid token")
		return
	}

	p := r.URL.Path
	switch {
	// Companion & Auth
	case p == "/companion/v1/status" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.CompanionStatus{
			HostID: s.HostID, HostName: s.HostName, DesktopVersion: "0.9.4",
			ComputerID: "comp_mac_1", DaemonConnection: "connected", RuntimeState: "ready",
			ActiveOperations: 1, DeviceID: s.DeviceID, PairedDevicesCount: 1,
		})
	case p == "/companion/v1/token/rotate" && r.Method == http.MethodPost:
		s.mu.Lock()
		s.TokenRotatedCount++
		s.ValidToken = fmt.Sprintf("c2_test_token_rot_%d", s.TokenRotatedCount)
		resp := api.TokenRotateResponse{DeviceID: s.DeviceID, Token: s.ValidToken}
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, resp)
	case p == "/companion/v1/unpair" && r.Method == http.MethodPost:
		s.mu.Lock()
		s.Unpaired = true
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.UnpairResponse{Unpaired: true})
	case p == "/v0/me" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.Identity)
	case p == "/v0/tenants" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.TenantList{Items: []api.Tenant{{ID: s.TenantID, Name: "Alex Workspace", CreatedAt: time.Now().UTC()}}})
	case p == "/v0/tenants/"+s.TenantID+"/actors" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.ActorPage{Items: s.Actors})
	case p == "/v0/tenants/"+s.TenantID+"/rooms" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.RoomListPage{Items: s.Rooms})
	case strings.HasPrefix(p, "/v0/rooms/") && strings.HasSuffix(p, "/messages") && r.Method == http.MethodPost:
		roomID := extractMiddleSegment(p, "/v0/rooms/", "/messages")
		var req api.CreateMessageRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		s.mu.Lock()
		seq := int64(len(s.Messages[roomID]) + 1)
		msg := api.Message{
			ID: s.nextID("msg"), TenantID: s.TenantID, RoomID: roomID, RoomSeq: &seq,
			Author:      api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"},
			MessageKind: "conversation", RawMessage: req.RawMessage, CreatedAt: time.Now().UTC(),
		}
		s.Messages[roomID] = append(s.Messages[roomID], msg)
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, msg)
	default:
		if !s.ServeC2Route(w, r) {
			writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "route not found: "+r.Method+" "+p)
		}
	}
}

// ServeC2Route dispatches all Wave C-2 routes (Work Items, Tasks, Routines, Pocket Notes,
// Library Documents/Trees/Search, Personal Wiki/Graph, Memory/Voice, Proactive Rules,
// Profiles/Insights, External Connections, Web Search, Voice Keys) without re-checking auth.
func (s *C2FakeServer) ServeC2Route(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	switch {
	case p == "/v0/tenants/"+s.TenantID+"/another-me" && r.Method == http.MethodGet:
		agentID := s.AnotherMe.ID
		roomID := s.DirectRoom.ID
		writeJSON(w, http.StatusOK, api.AnotherMeSummary{AgentActorID: &agentID, RoomID: &roomID})

	// Work Items
	case p == "/v0/tenants/"+s.TenantID+"/work-items" && r.Method == http.MethodGet:
		s.handleListWorkItems(w, r)
	case p == "/v0/tenants/"+s.TenantID+"/work-items" && r.Method == http.MethodPost:
		s.handleCreateWorkItem(w, r)
	case strings.HasPrefix(p, "/v0/work-items/") && strings.HasSuffix(p, "/transitions") && r.Method == http.MethodPost:
		s.handleTransitionWorkItem(w, r, extractMiddleSegment(p, "/v0/work-items/", "/transitions"))
	case strings.HasPrefix(p, "/v0/work-items/") && strings.HasSuffix(p, "/archive") && r.Method == http.MethodPost:
		s.handleArchiveWorkItem(w, r, extractMiddleSegment(p, "/v0/work-items/", "/archive"), true)
	case strings.HasPrefix(p, "/v0/work-items/") && strings.HasSuffix(p, "/unarchive") && r.Method == http.MethodPost:
		s.handleArchiveWorkItem(w, r, extractMiddleSegment(p, "/v0/work-items/", "/unarchive"), false)
	case strings.HasPrefix(p, "/v0/work-items/") && strings.Contains(p, "/assignments/") && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		s.handleWorkItemAssignment(w, r, p)
	case strings.HasPrefix(p, "/v0/work-items/") && strings.Contains(p, "/comments") && (r.Method == http.MethodGet || r.Method == http.MethodPost || r.Method == http.MethodPatch || r.Method == http.MethodDelete):
		s.handleWorkItemComments(w, r, p)
	case strings.HasPrefix(p, "/v0/work-items/") && strings.HasSuffix(p, "/timeline") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/work-items/", "/timeline")
		s.mu.Lock()
		items := append([]api.WorkItemTimelineEntry(nil), s.WorkItemTimeline[id]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.WorkItemTimelinePage{Items: items})
	case strings.HasPrefix(p, "/v0/work-items/") && !strings.Contains(strings.TrimPrefix(p, "/v0/work-items/"), "/") && (r.Method == http.MethodGet || r.Method == http.MethodPatch):
		id := strings.TrimPrefix(p, "/v0/work-items/")
		if r.Method == http.MethodGet {
			s.handleGetWorkItem(w, id)
		} else {
			s.handleUpdateWorkItem(w, r, id)
		}
	case strings.HasPrefix(p, "/v0/tasks/") && strings.HasSuffix(p, "/execution") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/tasks/", "/execution")
		s.mu.Lock()
		ex, ok := s.TaskExecutions[id]
		s.mu.Unlock()
		if !ok {
			writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "task execution not found")
			return true
		}
		writeJSON(w, http.StatusOK, ex)
	case strings.HasPrefix(p, "/v0/tasks/") && strings.HasSuffix(p, "/conversation") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/tasks/", "/conversation")
		s.mu.Lock()
		conv := s.TaskConversations[id]
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, conv)
	case strings.HasPrefix(p, "/v0/tasks/") && strings.HasSuffix(p, "/runtime-presentation-runs") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/tasks/", "/runtime-presentation-runs")
		s.mu.Lock()
		runs := s.TaskRuns[id]
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, runs)

	// Routines
	case strings.HasPrefix(p, "/v0/rooms/") && strings.HasSuffix(p, "/routines") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(p, "/v0/rooms/", "/routines")
		s.mu.Lock()
		items := append([]api.Routine(nil), s.RoutinesByRoom[roomID]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RoutineList{Items: items})
	case strings.HasPrefix(p, "/v0/rooms/") && strings.HasSuffix(p, "/routines") && r.Method == http.MethodPost:
		s.handleCreateRoutine(w, r, extractMiddleSegment(p, "/v0/rooms/", "/routines"))
	case strings.HasPrefix(p, "/v0/routines/") && strings.HasSuffix(p, "/run") && r.Method == http.MethodPost:
		s.handleRunRoutine(w, extractMiddleSegment(p, "/v0/routines/", "/run"))
	case strings.HasPrefix(p, "/v0/routines/") && r.Method == http.MethodPatch:
		s.handleUpdateRoutine(w, r, strings.TrimPrefix(p, "/v0/routines/"))
	case strings.HasPrefix(p, "/v0/routines/") && r.Method == http.MethodDelete:
		s.handleDeleteRoutine(w, r, strings.TrimPrefix(p, "/v0/routines/"))

	// Pocket Notes
	case p == "/v0/tenants/"+s.TenantID+"/me/pocket-notes" && r.Method == http.MethodGet:
		s.mu.Lock()
		items := append([]api.PocketNoteRecord(nil), s.PocketNotes...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.PocketNoteRecordPage{Today: "2026-11-24", Items: items})
	case p == "/v0/tenants/"+s.TenantID+"/me/pocket-notes/today" && r.Method == http.MethodPut:
		s.handlePutTodayPocketNote(w, r)
	case strings.HasPrefix(p, "/v0/tenants/"+s.TenantID+"/me/pocket-notes/") && r.Method == http.MethodDelete:
		noteDate := strings.TrimPrefix(p, "/v0/tenants/"+s.TenantID+"/me/pocket-notes/")
		s.handleDeletePocketNote(w, noteDate)

	// Search
	case p == "/v0/tenants/"+s.TenantID+"/messages/search" && r.Method == http.MethodGet:
		s.handleSearchMessages(w, r)
	case p == "/v0/library/documents/search" && r.Method == http.MethodGet:
		s.handleSearchDocs(w, r)

	// Library & Documents
	case p == "/v0/library/documents" && r.Method == http.MethodGet:
		view := r.URL.Query().Get("view")
		switch view {
		case "recent", "owned", "shared", "unfiled", "shareable":
		default:
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "view query parameter is required")
			return true
		}
		s.mu.Lock()
		docs := append([]api.Document(nil), s.Documents...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.DocumentPage{Items: docs})
	case p == "/v0/tenants/"+s.TenantID+"/me/document-tree" && r.Method == http.MethodGet:
		s.mu.Lock()
		tree := s.MyTree
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, tree)
	case p == "/v0/tenants/"+s.TenantID+"/me/shared-document-tree" && r.Method == http.MethodGet:
		s.mu.Lock()
		tree := s.SharedTree
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, tree)
	case strings.HasPrefix(p, "/v0/rooms/") && strings.HasSuffix(p, "/documents") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(p, "/v0/rooms/", "/documents")
		s.handleListRoomDocs(w, roomID)
	case p == "/v0/tenants/"+s.TenantID+"/documents" && r.Method == http.MethodPost:
		s.handleCreateDocument(w, r)
	case p == "/v0/tenants/"+s.TenantID+"/documents/uploads" && r.Method == http.MethodPost:
		s.handleUploadDocument(w, r)
	case strings.HasPrefix(p, "/v0/documents/") && strings.HasSuffix(p, "/downloads") && r.Method == http.MethodGet:
		s.handleDownloadDoc(w, extractMiddleSegment(p, "/v0/documents/", "/downloads"))
	case strings.HasPrefix(p, "/v0/documents/") && strings.HasSuffix(p, "/versions") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/documents/", "/versions")
		s.mu.Lock()
		vers := append([]api.DocumentVersion(nil), s.DocVersions[id]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.DocumentVersionList{Items: vers})
	case strings.HasPrefix(p, "/v0/documents/") && strings.HasSuffix(p, "/history") && r.Method == http.MethodGet:
		id := extractMiddleSegment(p, "/v0/documents/", "/history")
		s.mu.Lock()
		hist := append([]api.DocumentHistoryEntry(nil), s.DocHistory[id]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.DocumentHistoryPage{Items: hist})
	case strings.HasPrefix(p, "/v0/documents/") && strings.Contains(p, "/history/") && strings.HasSuffix(p, "/restore") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
	case strings.HasPrefix(p, "/v0/document-versions/") && strings.HasSuffix(p, "/content") && r.Method == http.MethodGet:
		s.handleDownloadVersion(w, extractMiddleSegment(p, "/v0/document-versions/", "/content"))
	case strings.HasPrefix(p, "/v0/document-versions/") && strings.HasSuffix(p, "/preview-sessions") && r.Method == http.MethodPost:
		verID := extractMiddleSegment(p, "/v0/document-versions/", "/preview-sessions")
		tok := "prev_tok_" + verID
		s.mu.Lock()
		s.PreviewFiles[tok] = "<html><body>Preview</body></html>"
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, api.DocumentPreviewSession{
			PreviewURL: s.URL + "/v0/document-previews/" + tok + "/index.html",
			ExpiresAt:  time.Now().UTC().Add(15 * time.Minute),
		})
	case strings.HasPrefix(p, "/v0/document-previews/") && r.Method == http.MethodGet:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><body><h1>Preview</h1></body></html>"))
	case strings.HasPrefix(p, "/v0/documents/") && strings.HasSuffix(p, "/comment-threads"):
		s.handleDocCommentThreads(w, r, extractMiddleSegment(p, "/v0/documents/", "/comment-threads"))
	case strings.HasPrefix(p, "/v0/document-comment-threads/") && strings.HasSuffix(p, "/comments") && r.Method == http.MethodPost:
		s.handleReplyDocCommentThread(w, r, extractMiddleSegment(p, "/v0/document-comment-threads/", "/comments"))
	case strings.HasPrefix(p, "/v0/document-comment-threads/") && r.Method == http.MethodPatch:
		s.handleResolveDocCommentThread(w, r, strings.TrimPrefix(p, "/v0/document-comment-threads/"))
	case strings.HasPrefix(p, "/v0/documents/") && strings.HasSuffix(p, "/link-share"):
		s.handleDocLinkShare(w, r, extractMiddleSegment(p, "/v0/documents/", "/link-share"))
	case strings.HasPrefix(p, "/v0/documents/") && !strings.Contains(strings.TrimPrefix(p, "/v0/documents/"), "/"):
		s.handleSingleDocument(w, r, strings.TrimPrefix(p, "/v0/documents/"))

	// Personal Wiki & Graph
	case p == "/v0/tenants/"+s.TenantID+"/personal-wiki" && r.Method == http.MethodGet:
		s.mu.Lock()
		wk := s.PersonalWiki
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, wk)
	case p == "/v0/tenants/"+s.TenantID+"/personal-wiki/refresh" && r.Method == http.MethodPost:
		s.mu.Lock()
		s.PersonalWiki.PublishedGeneration++
		s.PersonalWiki.State = "ready"
		s.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]string{"outcome": "started"})
	case p == "/v0/tenants/"+s.TenantID+"/personal-wiki/preview" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.WikiPreview)
	case p == "/v0/tenants/"+s.TenantID+"/personal-wiki/documents" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.DocumentPage{Items: s.WikiDocuments})
	case p == "/v0/tenants/"+s.TenantID+"/personal-wiki/graph" && r.Method == http.MethodGet:
		s.handleWikiGraphHTML(w)

	// Memory & Voice
	case p == "/v0/tenants/"+s.TenantID+"/memory" && r.Method == http.MethodGet:
		s.handleListMemory(w, r)
	case strings.HasPrefix(p, "/v0/tenants/"+s.TenantID+"/memory/") && r.Method == http.MethodGet:
		id := strings.TrimPrefix(p, "/v0/tenants/"+s.TenantID+"/memory/")
		s.handleGetMemoryEntry(w, id)
	case strings.HasPrefix(p, "/v0/rooms/") && strings.HasSuffix(p, "/active-voice-capture") && r.Method == http.MethodGet:
		s.mu.Lock()
		vc := s.VoiceCapture
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, vc)
	case strings.HasPrefix(p, "/v0/voice-captures/") && strings.HasSuffix(p, "/stop") && r.Method == http.MethodPost:
		s.mu.Lock()
		s.VoiceCapture.Status = "completed"
		vc := s.VoiceCapture
		s.mu.Unlock()
		writeJSON(w, http.StatusAccepted, vc)
	case strings.HasPrefix(p, "/v0/voice-captures/") && strings.HasSuffix(p, "/transcript-recovery/retry") && r.Method == http.MethodPost:
		s.mu.Lock()
		recovered := "completed"
		s.VoiceCapture.TranscriptRecoveryStatus = &recovered
		s.VoiceCapture.GapCount = 0
		s.VoiceCapture.GapDurationMs = 0
		vc := s.VoiceCapture
		s.mu.Unlock()
		writeJSON(w, http.StatusAccepted, vc)
	case strings.HasPrefix(p, "/v0/voice-captures/") && strings.Contains(p, "/questions/") && strings.HasSuffix(p, "/task") && r.Method == http.MethodPost:
		parts := strings.Split(strings.Trim(p, "/"), "/")
		qid := ""
		if len(parts) >= 5 {
			qid = parts[4]
		}
		s.handleVoiceQuestionTask(w, qid)
	case strings.HasPrefix(p, "/v0/voice-captures/") && strings.HasSuffix(p, "/questions"):
		s.handleVoiceQuestions(w, r)
	case strings.HasPrefix(p, "/v0/voice-captures/") && !strings.Contains(strings.TrimPrefix(p, "/v0/voice-captures/"), "/") && r.Method == http.MethodGet:
		s.mu.Lock()
		vc := s.VoiceCapture
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, vc)
	case strings.HasPrefix(p, "/v0/voice-sessions/") && strings.HasSuffix(p, "/transcript-events") && r.Method == http.MethodGet:
		s.mu.Lock()
		items := append([]api.VoiceTranscriptEvent(nil), s.VoiceTranscripts...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.VoiceTranscriptEventPage{Items: items})
	case strings.HasPrefix(p, "/v0/voice-sessions/") && strings.HasSuffix(p, "/events/stream") && r.Method == http.MethodGet:
		s.handleVoiceSSE(w, r)

	// Settings: Proactive Rules, Profiles, Insights, Connectors, Web Search, Voice Keys
	case p == "/v0/tenants/"+s.TenantID+"/me/proactive-rules" && r.Method == http.MethodGet:
		s.mu.Lock()
		book := s.ProactiveRules
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, book)
	case strings.HasPrefix(p, "/v0/tenants/"+s.TenantID+"/me/proactive-rules/"):
		s.handleProactiveRuleMutation(w, r, p)
	case p == "/v0/tenants/"+s.TenantID+"/account-profile" && (r.Method == http.MethodGet || r.Method == http.MethodPatch):
		s.handleAccountProfile(w, r)
	case p == "/v0/tenants/"+s.TenantID+"/personal-profile" && r.Method == http.MethodGet:
		s.mu.Lock()
		pp := s.PersonalProfile
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, pp)
	case p == "/v0/tenants/"+s.TenantID+"/personal-profile/revisions" && r.Method == http.MethodPost:
		s.handleReplacePersonalProfile(w, r)
	case p == "/v0/tenants/"+s.TenantID+"/personal-insights" && r.Method == http.MethodGet:
		s.mu.Lock()
		items := append([]api.PersonalInsight(nil), s.PersonalInsights...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.PersonalInsightList{Items: items})
	case strings.HasPrefix(p, "/v0/tenants/"+s.TenantID+"/personal-insights/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(p, "/v0/tenants/"+s.TenantID+"/personal-insights/")
		s.handleDeleteInsight(w, id)
	case p == "/v0/external-apps" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.ExternalApps)
	case p == "/v0/external-connections" && r.Method == http.MethodGet:
		s.mu.Lock()
		conns := append([]api.ExternalConnectionC2(nil), s.ExternalConns...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"connections": conns})
	case p == "/v0/external-connections" && r.Method == http.MethodPost:
		var req struct {
			AppKey             string  `json:"app_key"`
			DesktopCallbackURL *string `json:"desktop_callback_url"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || strings.TrimSpace(req.AppKey) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "app_key is required")
			return true
		}
		now := time.Now().UTC()
		conn := api.ExternalConnection{
			ID:        "conn_new_" + req.AppKey,
			Provider:  req.AppKey,
			Status:    "pending",
			Revision:  1,
			CreatedAt: now,
			UpdatedAt: now,
		}
		writeJSON(w, http.StatusCreated, conn)
	case strings.HasPrefix(p, "/v0/external-connections/"):
		s.handleExternalConnMutation(w, r, p)
	case p == "/v0/web-search/backends" && r.Method == http.MethodGet:
		s.mu.Lock()
		ws := s.WebSearch
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, ws)
	case strings.HasPrefix(p, "/v0/web-search/backends/") && strings.HasSuffix(p, "/key"):
		s.handleWebSearchKey(w, r, extractMiddleSegment(p, "/v0/web-search/backends/", "/key"))
	case p == "/v0/web-search/default":
		s.handleWebSearchDefault(w, r)
	case p == "/v0/tenants/"+s.TenantID+"/voice-media-policy" && r.Method == http.MethodGet:
		s.mu.Lock()
		vp := s.VoicePolicy
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, vp)
	case strings.HasPrefix(p, "/v0/voice-provider-keys/") && r.Method == http.MethodPut:
		s.handleVoiceKey(w, r, strings.TrimPrefix(p, "/v0/voice-provider-keys/"))
	default:
		return false
	}
	return true
}

func (s *C2FakeServer) handleListWorkItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	scope := q.Get("scope")
	archivedParam := q.Get("archived")
	wantArchived := archivedParam == "true"

	s.mu.Lock()
	var out []api.WorkItem
	for _, wi := range s.WorkItems {
		isArchived := wi.ArchivedAt != nil
		if archivedParam != "" {
			if wantArchived != isArchived {
				continue
			}
		} else if isArchived {
			continue
		}
		if state != "" && wi.State != state {
			continue
		}
		if scope == "personal" && wi.CreatedBy.ID != "act_human_1" {
			continue
		}
		out = append(out, wi)
	}
	s.mu.Unlock()
	if out == nil {
		out = []api.WorkItem{}
	}
	writeJSON(w, http.StatusOK, api.WorkItemPage{Items: out})
}

func (s *C2FakeServer) handleCreateWorkItem(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key header is required")
		return
	}
	var req api.WorkItemCreateInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Title) == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Work Item title is required")
		return
	}
	now := time.Now().UTC()
	human := api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"}
	desc := ""
	if req.Description != nil {
		desc = *req.Description
	}
	prio := "medium"
	if req.Priority != nil && *req.Priority != "" {
		prio = *req.Priority
	}
	kind := req.Kind
	if kind == "" {
		kind = "issue"
	}
	s.mu.Lock()
	num := int64(20 + len(s.WorkItems))
	wi := api.WorkItem{
		ID: s.nextID("wi"), TenantID: s.TenantID, Number: num, Kind: kind,
		Title: strings.TrimSpace(req.Title), Description: desc, State: "open", Priority: prio,
		Version: 1, OriginRoomID: req.OriginRoomID, CreatedBy: human, UpdatedBy: human,
		CreatedAt: now, UpdatedAt: now,
	}
	s.WorkItems = append([]api.WorkItem{wi}, s.WorkItems...)
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, wi)
}

func (s *C2FakeServer) handleGetWorkItem(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, wi := range s.WorkItems {
		if wi.ID == id {
			writeJSON(w, http.StatusOK, wi)
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "work item not found")
}

func (s *C2FakeServer) handleUpdateWorkItem(w http.ResponseWriter, r *http.Request, id string) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	var req api.WorkItemUpdateInput
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.WorkItems {
		if s.WorkItems[i].ID == id {
			if req.Title != nil {
				s.WorkItems[i].Title = *req.Title
			}
			if req.Description != nil {
				s.WorkItems[i].Description = *req.Description
			}
			if req.Priority != nil {
				s.WorkItems[i].Priority = *req.Priority
			}
			s.WorkItems[i].Version++
			s.WorkItems[i].UpdatedAt = time.Now().UTC()
			writeJSON(w, http.StatusOK, s.WorkItems[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "work item not found")
}

func (s *C2FakeServer) handleTransitionWorkItem(w http.ResponseWriter, r *http.Request, id string) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	var req struct {
		State           string  `json:"state"`
		Resolution      *string `json:"resolution"`
		ExpectedVersion int64   `json:"expected_version"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.WorkItems {
		if s.WorkItems[i].ID == id {
			from := s.WorkItems[i].State
			s.WorkItems[i].State = req.State
			s.WorkItems[i].Resolution = req.Resolution
			s.WorkItems[i].Version++
			s.WorkItems[i].UpdatedAt = time.Now().UTC()
			s.WorkItemTimeline[id] = append(s.WorkItemTimeline[id], api.WorkItemTimelineEntry{
				Type: "activity",
				Activity: &api.WorkItemActivity{
					ID: s.nextID("wia"), WorkItemID: id, Kind: "state_transition",
					Actor:     api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"},
					FromState: &from, ToState: &req.State, OccurredAt: time.Now().UTC(),
				},
			})
			writeJSON(w, http.StatusOK, s.WorkItems[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "work item not found")
}

func (s *C2FakeServer) handleArchiveWorkItem(w http.ResponseWriter, r *http.Request, id string, archive bool) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.WorkItems {
		if s.WorkItems[i].ID == id {
			if archive {
				now := time.Now().UTC()
				s.WorkItems[i].ArchivedAt = &now
			} else {
				s.WorkItems[i].ArchivedAt = nil
			}
			s.WorkItems[i].Version++
			writeJSON(w, http.StatusOK, s.WorkItems[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "work item not found")
}

func (s *C2FakeServer) handleWorkItemAssignment(w http.ResponseWriter, r *http.Request, p string) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) < 5 {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "bad path")
		return
	}
	wiID, actorID := parts[2], parts[4]
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.WorkItems {
		if s.WorkItems[i].ID != wiID {
			continue
		}
		if r.Method == http.MethodDelete {
			var filtered []api.WorkItemAssignment
			for _, a := range s.WorkItems[i].Assignees {
				if a.Actor.ID != actorID {
					filtered = append(filtered, a)
				}
			}
			s.WorkItems[i].Assignees = filtered
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var ref api.ActorRef
		for _, act := range s.Actors {
			if act.ID == actorID {
				ref = api.ActorRef{ID: act.ID, TenantID: act.TenantID, Kind: act.Kind, DisplayName: act.DisplayName}
			}
		}
		if ref.ID == "" {
			ref = api.ActorRef{ID: actorID, TenantID: s.TenantID, Kind: "human", DisplayName: actorID}
		}
		assign := api.WorkItemAssignment{Actor: ref, AssignedAt: time.Now().UTC()}
		s.WorkItems[i].Assignees = append(s.WorkItems[i].Assignees, assign)
		writeJSON(w, http.StatusOK, assign)
		return
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "work item not found")
}

func (s *C2FakeServer) handleWorkItemComments(w http.ResponseWriter, r *http.Request, p string) {
	trimmed := strings.TrimPrefix(p, "/v0/work-items/")
	parts := strings.Split(trimmed, "/")
	wiID := parts[0]
	if r.Method == http.MethodGet {
		s.mu.Lock()
		items := append([]api.WorkItemComment(nil), s.WorkItemComments[wiID]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.WorkItemCommentPage{Items: items})
		return
	}
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			Body string `json:"body"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		s.mu.Lock()
		c := api.WorkItemComment{
			ID: s.nextID("wic"), TenantID: s.TenantID, WorkItemID: wiID,
			Author: api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"},
			Body:   req.Body, Version: 1, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
		}
		s.WorkItemComments[wiID] = append(s.WorkItemComments[wiID], c)
		s.WorkItemTimeline[wiID] = append(s.WorkItemTimeline[wiID], api.WorkItemTimelineEntry{Type: "comment", Comment: &c})
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, c)
		return
	}
	if len(parts) < 3 {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "missing comment ID")
		return
	}
	cid := parts[2]
	s.mu.Lock()
	defer s.mu.Unlock()
	comments := s.WorkItemComments[wiID]
	for i := range comments {
		if comments[i].ID == cid {
			if r.Method == http.MethodPatch {
				var req struct {
					Body string `json:"body"`
				}
				_ = json.NewDecoder(r.Body).Decode(&req)
				comments[i].Body = req.Body
				comments[i].Version++
				comments[i].UpdatedAt = time.Now().UTC()
			} else if r.Method == http.MethodDelete {
				now := time.Now().UTC()
				comments[i].DeletedAt = &now
				comments[i].Version++
			}
			s.WorkItemComments[wiID] = comments
			writeJSON(w, http.StatusOK, comments[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "comment not found")
}

func (s *C2FakeServer) handleCreateRoutine(w http.ResponseWriter, r *http.Request, roomID string) {
	s.waitRoutineGate()
	s.mu.Lock()
	if s.FailNextRoutine != "" {
		msg := s.FailNextRoutine
		s.FailNextRoutine = ""
		s.mu.Unlock()
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", msg)
		return
	}
	s.mu.Unlock()

	var req api.RoutineCreateInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "routine name is required")
		return
	}
	cadenceRaw, _ := json.Marshal(req.Cadence)
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	now := time.Now().UTC()
	s.mu.Lock()
	rt := api.Routine{
		ID: s.nextID("rt"), RoomID: roomID, Name: req.Name, Instruction: req.Instruction,
		Enabled: enabled, Revision: 1, Cadence: cadenceRaw,
		NextRunAt: timePtr(now.Add(time.Hour)), CreatedByActorID: "act_human_1",
		CreatedAt: now, UpdatedAt: now,
	}
	s.RoutinesByRoom[roomID] = append([]api.Routine{rt}, s.RoutinesByRoom[roomID]...)
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, rt)
}

func (s *C2FakeServer) handleUpdateRoutine(w http.ResponseWriter, r *http.Request, routineID string) {
	s.waitRoutineGate()
	s.mu.Lock()
	if s.FailNextRoutine != "" {
		msg := s.FailNextRoutine
		s.FailNextRoutine = ""
		s.mu.Unlock()
		writeJSONError(w, http.StatusConflict, "CONFLICT", msg)
		return
	}
	s.mu.Unlock()

	var req api.RoutineUpdateInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ExpectedRevision < 1 {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "expected_revision >= 1 required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for roomID, list := range s.RoutinesByRoom {
		for i := range list {
			if list[i].ID == routineID {
				if req.Name != nil {
					list[i].Name = *req.Name
				}
				if req.Instruction != nil {
					list[i].Instruction = *req.Instruction
				}
				if req.Enabled != nil {
					list[i].Enabled = *req.Enabled
				}
				if req.Cadence != nil {
					raw, _ := json.Marshal(req.Cadence)
					list[i].Cadence = raw
				}
				list[i].Revision++
				list[i].UpdatedAt = time.Now().UTC()
				s.RoutinesByRoom[roomID] = list
				writeJSON(w, http.StatusOK, list[i])
				return
			}
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "routine not found")
}

func (s *C2FakeServer) handleRunRoutine(w http.ResponseWriter, routineID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for roomID, list := range s.RoutinesByRoom {
		for i := range list {
			if list[i].ID == routineID {
				list[i].UpdatedAt = time.Now().UTC()
				s.RoutinesByRoom[roomID] = list
				writeJSON(w, http.StatusOK, list[i])
				return
			}
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "routine not found")
}

func (s *C2FakeServer) handleDeleteRoutine(w http.ResponseWriter, r *http.Request, routineID string) {
	rev, _ := strconv.ParseInt(r.URL.Query().Get("expected_revision"), 10, 64)
	if rev < 1 {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "expected_revision query parameter required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for roomID, list := range s.RoutinesByRoom {
		for i := range list {
			if list[i].ID == routineID {
				s.RoutinesByRoom[roomID] = append(list[:i], list[i+1:]...)
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "routine not found")
}

func (s *C2FakeServer) waitRoutineGate() {
	s.mu.Lock()
	delay := s.RoutineSaveDelay
	gate := s.RoutineSaveGate
	s.mu.Unlock()
	if delay > 0 {
		time.Sleep(delay)
	}
	if gate != nil {
		<-gate
	}
}

func (s *C2FakeServer) handlePutTodayPocketNote(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
		Body string `json:"body"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	txt := req.Text
	if txt == "" {
		txt = req.Body
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.PocketPutCount++
	if s.FailPocketNotePut {
		writeJSONError(w, http.StatusServiceUnavailable, "OFFLINE", "simulated pocket note save failure")
		return
	}
	today := "2026-11-24"
	rec := api.PocketNoteRecord{Date: today, Text: txt, UpdatedAt: time.Now().UTC()}
	replaced := false
	for i := range s.PocketNotes {
		if s.PocketNotes[i].Date == today {
			s.PocketNotes[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		s.PocketNotes = append([]api.PocketNoteRecord{rec}, s.PocketNotes...)
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *C2FakeServer) handleDeletePocketNote(w http.ResponseWriter, noteDate string) {
	if noteDate == "2026-11-24" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "cannot delete today")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var filtered []api.PocketNoteRecord
	for _, n := range s.PocketNotes {
		if n.Date != noteDate {
			filtered = append(filtered, n)
		}
	}
	s.PocketNotes = filtered
	w.WriteHeader(http.StatusNoContent)
}

func (s *C2FakeServer) handleSearchMessages(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	s.mu.Lock()
	var hits []api.MessageSearchHit
	for roomID, msgs := range s.Messages {
		roomName := roomID
		for _, rm := range s.Rooms {
			if rm.ID == roomID {
				roomName = rm.Name
				break
			}
		}
		for _, m := range msgs {
			if strings.Contains(strings.ToLower(m.RawMessage), q) || strings.Contains(strings.ToLower(m.Author.DisplayName), q) {
				hits = append(hits, api.MessageSearchHit{
					Message: m,
					Room:    api.MessageSearchRoom{ID: roomID, Name: roomName, Kind: "group"},
				})
			}
		}
	}
	s.mu.Unlock()
	if hits == nil {
		hits = []api.MessageSearchHit{}
	}
	writeJSON(w, http.StatusOK, api.MessageSearchPage{Items: hits})
}

func (s *C2FakeServer) handleSearchDocs(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	s.mu.Lock()
	var docs []api.Document
	for _, d := range s.Documents {
		body := strings.ToLower(string(s.DocContents[d.ID]))
		if strings.Contains(strings.ToLower(d.Title), q) || strings.Contains(body, q) {
			docs = append(docs, d)
		}
	}
	s.mu.Unlock()
	if docs == nil {
		docs = []api.Document{}
	}
	writeJSON(w, http.StatusOK, api.DocumentPage{Items: docs})
}

func (s *C2FakeServer) handleListRoomDocs(w http.ResponseWriter, roomID string) {
	s.mu.Lock()
	ids := s.RoomDocIDs[roomID]
	var out []api.Document
	for _, id := range ids {
		for _, d := range s.Documents {
			if d.ID == id {
				out = append(out, d)
			}
		}
	}
	s.mu.Unlock()
	if out == nil {
		out = []api.Document{}
	}
	writeJSON(w, http.StatusOK, api.DocumentPage{Items: out})
}

func (s *C2FakeServer) handleCreateDocument(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ParentID             *string `json:"parent_id"`
		RepresentationFormat string  `json:"representation_format"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RepresentationFormat == "" {
		req.RepresentationFormat = "markdown"
	}
	now := time.Now().UTC()
	s.mu.Lock()
	id := s.nextID("doc")
	doc := api.Document{
		ID: id, TenantID: s.TenantID, Title: "Untitled Note.md", Format: req.RepresentationFormat,
		RepresentationFormat: req.RepresentationFormat, Status: "active", CanEditNativeContent: true,
		CreatedAt: now, UpdatedAt: now,
	}
	s.Documents = append([]api.Document{doc}, s.Documents...)
	s.DocContents[id] = []byte("# New Note\n\nWrite your thoughts here.")
	s.DocContentTypes[id] = "text/markdown"
	s.MyTree.Items = append(s.MyTree.Items, api.DocumentTreeNode{
		ID: s.nextID("place"), NodeKind: "document", ParentID: req.ParentID, SortKey: "99",
		DocumentID: id, Document: &doc, CreatedAt: now, UpdatedAt: now,
	})
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, doc)
}

func (s *C2FakeServer) handleUploadDocument(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Idempotency-Key") == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key required")
		return
	}
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid multipart upload")
		return
	}
	filename := r.FormValue("filename")
	repr := r.FormValue("representation_format")
	mediaType := r.FormValue("media_type")
	f, _, err := r.FormFile("content")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "missing content")
		return
	}
	defer f.Close()
	data, _ := io.ReadAll(f)
	now := time.Now().UTC()
	s.mu.Lock()
	id := s.nextID("doc")
	doc := api.Document{
		ID: id, TenantID: s.TenantID, Title: filename, Format: repr,
		RepresentationFormat: repr, Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	s.Documents = append([]api.Document{doc}, s.Documents...)
	s.DocContents[id] = data
	s.DocContentTypes[id] = mediaType
	s.DocVersions[id] = []api.DocumentVersion{{
		ID: s.nextID("dv"), DocumentID: id, VersionNumber: 1, Filename: filename,
		MediaType: mediaType, RepresentationFormat: repr, SizeBytes: int64(len(data)),
		Source: "upload", CreatedAt: now,
	}}
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, doc)
}

func (s *C2FakeServer) handleDownloadDoc(w http.ResponseWriter, id string) {
	s.mu.Lock()
	data, ok := s.DocContents[id]
	ct := s.DocContentTypes[id]
	s.mu.Unlock()
	if !ok {
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "document content not found")
		return
	}
	if ct == "" {
		ct = "text/plain; charset=utf-8"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *C2FakeServer) handleDownloadVersion(w http.ResponseWriter, verID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for docID, vers := range s.DocVersions {
		for _, v := range vers {
			if v.ID == verID {
				w.Header().Set("Content-Type", v.MediaType)
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(s.DocContents[docID])
				return
			}
		}
	}
	// Provide non-WAV dummy bytes for recording version test to exercise graceful audio fallback.
	if verID == "dv_rec_1" {
		w.Header().Set("Content-Type", "audio/ogg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not-a-wav-stream"))
		return
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "version not found")
}

func (s *C2FakeServer) handleSingleDocument(w http.ResponseWriter, r *http.Request, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Documents {
		if s.Documents[i].ID == id {
			switch r.Method {
			case http.MethodGet:
				writeJSON(w, http.StatusOK, s.Documents[i])
			case http.MethodPatch:
				var req struct {
					Title string `json:"title"`
				}
				_ = json.NewDecoder(r.Body).Decode(&req)
				s.Documents[i].Title = req.Title
				s.Documents[i].UpdatedAt = time.Now().UTC()
				writeJSON(w, http.StatusOK, s.Documents[i])
			case http.MethodDelete:
				s.Documents = append(s.Documents[:i], s.Documents[i+1:]...)
				w.WriteHeader(http.StatusNoContent)
			}
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "document not found")
}

func (s *C2FakeServer) handleDocCommentThreads(w http.ResponseWriter, r *http.Request, docID string) {
	if r.Method == http.MethodGet {
		s.mu.Lock()
		items := append([]api.DocumentCommentThread(nil), s.DocCommentThreads[docID]...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.DocumentCommentThreadList{Items: items})
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			InitialComment struct {
				Segments []struct {
					Content string `json:"content"`
				} `json:"segments"`
			} `json:"initial_comment"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		body := ""
		if len(req.InitialComment.Segments) > 0 {
			body = req.InitialComment.Segments[0].Content
		}
		human := api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"}
		now := time.Now().UTC()
		s.mu.Lock()
		th := api.DocumentCommentThread{
			ID: s.nextID("dct"), DocumentID: docID, AnchorStatus: "attached", CreatedBy: human,
			Comments:  []api.DocumentComment{{ID: s.nextID("dc"), Body: body, Author: human, CreatedAt: now, UpdatedAt: now}},
			CreatedAt: now, UpdatedAt: now,
		}
		s.DocCommentThreads[docID] = append(s.DocCommentThreads[docID], th)
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, th)
	}
}

func (s *C2FakeServer) handleReplyDocCommentThread(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Segments []struct {
			Content string `json:"content"`
		} `json:"segments"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	body := ""
	if len(req.Segments) > 0 {
		body = req.Segments[0].Content
	}
	human := api.ActorRef{ID: "act_human_1", TenantID: s.TenantID, Kind: "human", DisplayName: "Alex Rivera"}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	for docID, list := range s.DocCommentThreads {
		for i := range list {
			if list[i].ID == threadID {
				c := api.DocumentComment{ID: s.nextID("dc"), Body: body, Author: human, CreatedAt: now, UpdatedAt: now}
				list[i].Comments = append(list[i].Comments, c)
				s.DocCommentThreads[docID] = list
				writeJSON(w, http.StatusCreated, c)
				return
			}
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "thread not found")
}

func (s *C2FakeServer) handleResolveDocCommentThread(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Resolved bool `json:"resolved"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	defer s.mu.Unlock()
	for docID, list := range s.DocCommentThreads {
		for i := range list {
			if list[i].ID == threadID {
				list[i].Resolved = req.Resolved
				list[i].UpdatedAt = time.Now().UTC()
				s.DocCommentThreads[docID] = list
				writeJSON(w, http.StatusOK, list[i])
				return
			}
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "thread not found")
}

func (s *C2FakeServer) handleDocLinkShare(w http.ResponseWriter, r *http.Request, docID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ls, ok := s.DocLinkShares[docID]
	if !ok {
		ls = api.DocumentLinkShare{ID: s.nextID("dls"), DocumentID: docID, Role: "viewer", Status: "inactive", Version: 1}
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, ls)
	case http.MethodPut:
		var req struct {
			Role            string `json:"role"`
			ExpectedVersion int64  `json:"expected_version"`
			Reset           bool   `json:"reset"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		ls.Role = req.Role
		ls.Status = "active"
		ls.Version++
		tok := "share_tok_" + docID
		u := "https://linger.example.com/shared-documents#" + tok
		ls.Token = &tok
		ls.URL = &u
		s.DocLinkShares[docID] = ls
		writeJSON(w, http.StatusOK, ls)
	case http.MethodDelete:
		ls.Status = "revoked"
		ls.Token = nil
		ls.URL = nil
		ls.Version++
		s.DocLinkShares[docID] = ls
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *C2FakeServer) handleWikiGraphHTML(w http.ResponseWriter) {
	s.mu.Lock()
	raw, _ := json.Marshal(s.WikiGraph)
	s.mu.Unlock()
	html := fmt.Sprintf(`<!doctype html><html><body><script>const graph=%s;</script></body></html>`, string(raw))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(html))
}

func (s *C2FakeServer) handleListMemory(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	s.mu.Lock()
	var out []api.PersonalMemoryEntryC2
	for _, m := range s.MemoryEntries {
		if kind == "" || m.Kind == kind {
			out = append(out, m)
		}
	}
	s.mu.Unlock()
	if out == nil {
		out = []api.PersonalMemoryEntryC2{}
	}
	writeJSON(w, http.StatusOK, api.PersonalMemoryPageC2{Items: out})
}

func (s *C2FakeServer) handleGetMemoryEntry(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.MemoryEntries {
		if m.ID == id {
			writeJSON(w, http.StatusOK, m)
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "memory entry not found")
}

func (s *C2FakeServer) handleVoiceQuestions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.mu.Lock()
		items := append([]api.VoiceCaptureQuestion(nil), s.VoiceQuestions...)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, api.VoiceCaptureQuestionList{Items: items})
		return
	}
	var req struct {
		Question string `json:"question"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	q := api.VoiceCaptureQuestion{
		ID: s.nextID("vq"), Kind: "question", Question: req.Question,
		Answer:   "Confirmed in transcript at 00:01: " + req.Question,
		Answered: true, CutoffOffsetMs: 4200, CreatedAt: time.Now().UTC(),
	}
	s.VoiceQuestions = append([]api.VoiceCaptureQuestion{q}, s.VoiceQuestions...)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, q)
}

func (s *C2FakeServer) handleVoiceQuestionTask(w http.ResponseWriter, qid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.VoiceQuestions {
		if s.VoiceQuestions[i].ID == qid {
			title := "Follow-up task from meeting"
			msgID := s.nextID("msg")
			s.VoiceQuestions[i].TaskTitle = &title
			s.VoiceQuestions[i].SentMessageID = &msgID
			writeJSON(w, http.StatusOK, s.VoiceQuestions[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "question not found")
}

func (s *C2FakeServer) handleVoiceSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no flusher", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	ch := make(chan SSEFrame, 32)
	s.mu.Lock()
	s.voiceSSESubs[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.voiceSSESubs, ch)
		s.mu.Unlock()
	}()

	_, _ = fmt.Fprint(w, "event: voice.ready\ndata: {}\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			writeSSEFrame(w, flusher, frame)
		}
	}
}

func (s *C2FakeServer) handleProactiveRuleMutation(w http.ResponseWriter, r *http.Request, p string) {
	rest := strings.TrimPrefix(p, "/v0/tenants/"+s.TenantID+"/me/proactive-rules/")
	parts := strings.Split(rest, "/")
	ruleID := parts[0]

	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i := range s.ProactiveRules.Rules {
		if s.ProactiveRules.Rules[i].ID == ruleID {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeJSONError(w, http.StatusNotFound, "PROACTIVE_RULE_NOT_FOUND", "rule not found")
		return
	}

	switch {
	case len(parts) == 1 && r.Method == http.MethodPatch:
		var req struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if strings.TrimSpace(req.Text) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "rule text cannot be empty")
			return
		}
		s.ProactiveRules.Rules[idx].Text = req.Text
		s.ProactiveRules.Rules[idx].Source = "user"
	case len(parts) == 1 && r.Method == http.MethodDelete:
		s.ProactiveRules.Rules = append(s.ProactiveRules.Rules[:idx], s.ProactiveRules.Rules[idx+1:]...)
	case len(parts) == 2 && parts[1] == "pin" && r.Method == http.MethodPut:
		var req struct {
			Pinned bool `json:"pinned"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		s.ProactiveRules.Rules[idx].Pinned = req.Pinned
	case len(parts) == 2 && parts[1] == "mandate" && r.Method == http.MethodPut:
		var req struct {
			Mandate string `json:"mandate"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		s.ProactiveRules.Rules[idx].Mandate = req.Mandate
	case len(parts) == 2 && parts[1] == "promotion" && r.Method == http.MethodPost:
		now := time.Now().UTC()
		s.ProactiveRules.Rules[idx].Status = "active"
		s.ProactiveRules.Rules[idx].PromotedAt = &now
	default:
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "unknown rule endpoint")
		return
	}
	s.ProactiveRules.Version++
	writeJSON(w, http.StatusOK, s.ProactiveRules)
}

func (s *C2FakeServer) handleAccountProfile(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPatch {
		var patch api.AccountProfilePatch
		_ = json.NewDecoder(r.Body).Decode(&patch)
		if patch.Name != nil {
			s.AccountProfile.Name = *patch.Name
		}
		if patch.Bio != nil {
			s.AccountProfile.Bio = *patch.Bio
		}
		if patch.Organization != nil {
			s.AccountProfile.Organization = *patch.Organization
		}
		now := time.Now().UTC()
		s.AccountProfile.UpdatedAt = &now
	}
	writeJSON(w, http.StatusOK, s.AccountProfile)
}

func (s *C2FakeServer) handleReplacePersonalProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseRevisionID string `json:"base_revision_id"`
		Markdown       string `json:"markdown"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	now := time.Now().UTC()
	s.mu.Lock()
	if s.PersonalProfile.Current != nil {
		s.PersonalProfile.History = append([]api.PersonalProfileRevisionC2{*s.PersonalProfile.Current}, s.PersonalProfile.History...)
	}
	rev := api.PersonalProfileRevisionC2{
		ID: s.nextID("ppr"), TenantID: s.TenantID, PromptVersion: "v2",
		Markdown: req.Markdown, CreatedAt: now,
	}
	s.PersonalProfile.Current = &rev
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, rev)
}

func (s *C2FakeServer) handleDeleteInsight(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var filtered []api.PersonalInsight
	for _, in := range s.PersonalInsights {
		if in.ID != id {
			filtered = append(filtered, in)
		}
	}
	s.PersonalInsights = filtered
	w.WriteHeader(http.StatusNoContent)
}

func (s *C2FakeServer) handleExternalConnMutation(w http.ResponseWriter, r *http.Request, p string) {
	rest := strings.TrimPrefix(p, "/v0/external-connections/")
	parts := strings.Split(rest, "/")
	connID := parts[0]

	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i := range s.ExternalConns {
		if s.ExternalConns[i].ID == connID {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
		return
	}

	switch {
	case len(parts) == 2 && parts[1] == "status-checks" && r.Method == http.MethodPost:
		now := time.Now().UTC()
		s.ExternalConns[idx].Status = "connected"
		s.ExternalConns[idx].StatusCheckedAt = &now
		s.ExternalConns[idx].StatusErrorCode = nil
		s.ExternalConns[idx].Revision++
		writeJSON(w, http.StatusAccepted, s.ExternalConns[idx])
	case len(parts) == 2 && parts[1] == "disconnects" && r.Method == http.MethodPost:
		s.ExternalConns[idx].Status = "disconnected"
		s.ExternalConns[idx].Revision++
		writeJSON(w, http.StatusAccepted, s.ExternalConns[idx])
	case len(parts) == 2 && parts[1] == "auto-reminders" && r.Method == http.MethodPut:
		var req struct {
			Enabled bool `json:"enabled"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		s.ExternalConns[idx].AutoReminders = req.Enabled
		s.ExternalConns[idx].Revision++
		writeJSON(w, http.StatusOK, s.ExternalConns[idx])
	case len(parts) == 2 && parts[1] == "agent-grants" && r.Method == http.MethodGet:
		agents := append([]api.ExternalConnectionAgentAccess(nil), s.ConnAgentGrants[connID]...)
		writeJSON(w, http.StatusOK, map[string]any{"agents": agents})
	case len(parts) == 3 && parts[1] == "agent-grants" && r.Method == http.MethodPut:
		actorID := parts[2]
		var req struct {
			Granted bool `json:"granted"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		grants := s.ConnAgentGrants[connID]
		for i := range grants {
			if grants[i].AgentActorID == actorID {
				grants[i].Granted = req.Granted
				grants[i].Revision++
				s.ConnAgentGrants[connID] = grants
				writeJSON(w, http.StatusOK, grants[i])
				return
			}
		}
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "agent grant not found")
	default:
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "unknown connection route")
	}
}

func (s *C2FakeServer) handleWebSearchKey(w http.ResponseWriter, r *http.Request, backendID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodDelete {
		delete(s.SavedSearchKeys, backendID)
		for i := range s.WebSearch.Backends {
			if s.WebSearch.Backends[i].ID == backendID {
				s.WebSearch.Backends[i].Status = "needs_key"
				s.WebSearch.Backends[i].KeyState = "missing"
			}
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var req struct {
		APIKey string `json:"api_key"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.APIKey) == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "api_key is required")
		return
	}
	s.SavedSearchKeys[backendID] = req.APIKey
	for i := range s.WebSearch.Backends {
		if s.WebSearch.Backends[i].ID == backendID {
			s.WebSearch.Backends[i].Status = "ready"
			s.WebSearch.Backends[i].KeyState = "saved"
			writeJSON(w, http.StatusOK, s.WebSearch.Backends[i])
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "backend not found")
}

func (s *C2FakeServer) handleWebSearchDefault(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodDelete {
		s.WebSearch.ChosenDefaultSearch = nil
		s.WebSearch.DefaultSearch = "duckduckgo"
		writeJSON(w, http.StatusOK, map[string]string{"default_search": s.WebSearch.DefaultSearch})
		return
	}
	var req struct {
		Backend string `json:"backend"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.WebSearch.DefaultSearch = req.Backend
	s.WebSearch.ChosenDefaultSearch = &req.Backend
	writeJSON(w, http.StatusOK, map[string]string{"default_search": req.Backend})
}

func (s *C2FakeServer) handleVoiceKey(w http.ResponseWriter, r *http.Request, provider string) {
	var req struct {
		APIKey string `json:"api_key"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.APIKey) == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "api_key is required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.SavedVoiceKeys[provider] = req.APIKey
	status := api.VoiceProviderKeyStatusC2{Source: "saved", CanSave: true, Configured: true}
	switch provider {
	case "soniox":
		s.VoicePolicy.SonioxKey = &status
		s.VoicePolicy.VoiceMediaSupported = true
	case "xai":
		s.VoicePolicy.XaiKey = &status
		t := true
		s.VoicePolicy.LiveEnabled = &t
	default:
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "unknown voice provider")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func strPtr(v string) *string        { return &v }
func timePtr(v time.Time) *time.Time { return &v }
