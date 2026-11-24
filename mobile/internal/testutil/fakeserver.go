// Package testutil provides a realistic Fake TeamHub + Companion HTTPS/HTTP +
// SSE server and shared ui.Tester viewport helpers for automated testing.
package testutil

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/discovery"
)

// SSEFrame is one programmable Server-Sent Event pushed by FakeServer.
type SSEFrame struct {
	Event   string
	ID      string
	Data    string
	Comment string
}

// FakeServer simulates both the Desktop Companion Gateway (/companion/v1/*)
// and TeamHub Public API (/v0/*) with real TLS 1.3 SPKI certificates and live SSE.
type FakeServer struct {
	Server      *httptest.Server
	URL         string
	TLS         bool
	Fingerprint string
	ShortCode   string

	mu              sync.Mutex
	HostID          string
	HostName        string
	DesktopVersion  string
	PairingOpen     bool
	PairCode        string
	PairPIN         string
	ValidToken      string
	ValidCookie     string
	DeviceID        string
	TenantID        string
	FailedPairCount int
	RejectCSRF      bool

	Rooms              []api.RoomListItem
	MessagesByRoom     map[string][]api.Message
	RoomEventsByRoom   map[string][]api.RoomEventEnvelope
	RunStatusesByRoom  map[string][]api.RoomRunStatus
	PresentationByRun  map[string][]json.RawMessage
	WorkItems          []api.WorkItem
	RoutinesByRoom     map[string][]api.Routine
	PocketNotes        []api.PocketNote
	Documents          []api.Document
	Agents             []api.TenantAgent
	Computers          []api.LocalComputer
	LocalModels        api.LocalModelsView
	ModelSource        api.ModelSourceView
	ProactiveRules     api.ProactiveRuleBook
	ExternalApps       api.ExternalAppList
	WebSearchBackends  api.WebSearchBackendList
	VoicePolicy        api.VoiceMediaPolicy
	VoiceSession       api.VoiceSession
	VoiceCapture       api.VoiceCapture
	VoiceQuestions     []api.VoiceCaptureQuestion
	AccountProfile     api.AccountProfile
	Identity           api.CurrentIdentity
	ObservedOrigin     int
	ObservedSecFetch   int
	RequestedEndpoints []string

	sseSubs      map[chan SSEFrame]struct{}
	voiceSSESubs map[chan SSEFrame]struct{}
}

// NewFakeServer starts a FakeServer over TLS 1.3 (when useTLS is true) or plain HTTP.
func NewFakeServer(useTLS bool) (*FakeServer, error) {
	now := time.Date(2026, 11, 24, 14, 0, 0, 0, time.UTC)
	human := api.ActorRef{ID: "act_human_1", TenantID: "ten_1", Kind: "human", DisplayName: "Alex Rivera"}
	agent := api.ActorRef{ID: "act_agent_1", TenantID: "ten_1", Kind: "agent", DisplayName: "Scout"}
	seq1, seq2 := int64(1), int64(2)
	voiceAvail := true
	liveEnabled := false

	fs := &FakeServer{
		TLS:            useTLS,
		HostID:         "host_studio_mac",
		HostName:       "Studio Mac",
		DesktopVersion: "0.9.4",
		PairingOpen:    true,
		PairCode:       "pair_code_secret_123",
		PairPIN:        "482910",
		ValidToken:     "lmc_test_token_001",
		ValidCookie:    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		DeviceID:       "dev_mobile_01",
		TenantID:       "ten_1",
		RejectCSRF:     true,
		sseSubs:        map[chan SSEFrame]struct{}{},
		voiceSSESubs:   map[chan SSEFrame]struct{}{},
		Identity: api.CurrentIdentity{
			Account: api.Account{
				ID:          "acc_1",
				Email:       "alex@linger.dev",
				DisplayName: "Alex Rivera",
				CreatedAt:   now,
			},
			Actors: []api.Actor{
				{ID: "act_human_1", TenantID: "ten_1", Kind: "human", DisplayName: "Alex Rivera", CreatedAt: now},
			},
		},
		Rooms: []api.RoomListItem{
			{
				ID:                 "room_general",
				TenantID:           "ten_1",
				Kind:               "group",
				Name:               "Product Launch",
				CreatedBy:          human,
				LatestRoomSeq:      2,
				ReadThroughRoomSeq: 1,
				UnreadMessageCount: 1,
				MemberPreview:      []api.ActorRef{human, agent},
				LatestMessage: &api.LatestMessageSummary{
					ID:         "msg_2",
					RoomSeq:    2,
					RawMessage: "Ready to review the release checklist.",
					Author:     agent,
					CreatedAt:  now,
				},
				CreatedAt: now,
				UpdatedAt: now,
			},
		},
		MessagesByRoom: map[string][]api.Message{
			"room_general": {
				{
					ID:          "msg_1",
					TenantID:    "ten_1",
					RoomID:      "room_general",
					RoomSeq:     &seq1,
					Author:      human,
					MessageKind: "conversation",
					RawMessage:  "Let us verify the build pipeline.",
					CreatedAt:   now.Add(-5 * time.Minute),
				},
				{
					ID:          "msg_2",
					TenantID:    "ten_1",
					RoomID:      "room_general",
					RoomSeq:     &seq2,
					Author:      agent,
					MessageKind: "conversation",
					RawMessage:  "Ready to review the release checklist.",
					Card: &api.DecisionRequestedMessageCard{
						CardType:      "decision_requested",
						DecisionID:    "dec_1",
						Kind:          "runtime_permission",
						Status:        "pending",
						Title:         "Run go test in linger-mobile",
						Intent:        "Verify unit tests before commit",
						Version:       1,
						Requester:     api.MessageCardActorRef{ID: agent.ID, Kind: "agent", DisplayName: agent.DisplayName},
						DecisionOwner: api.MessageCardActorRef{ID: human.ID, Kind: "human", DisplayName: human.DisplayName},
					},
					CreatedAt: now,
				},
			},
		},
		RoomEventsByRoom: map[string][]api.RoomEventEnvelope{
			"room_general": {
				{EventID: "evt_1", TenantID: "ten_1", RoomID: "room_general", RoomSeq: 1, EventType: "message.created", OccurredAt: now.Add(-5 * time.Minute), Actor: &human, Payload: json.RawMessage(`{"message_id":"msg_1"}`)},
				{EventID: "evt_2", TenantID: "ten_1", RoomID: "room_general", RoomSeq: 2, EventType: "message.created", OccurredAt: now, Actor: &agent, Payload: json.RawMessage(`{"message_id":"msg_2"}`)},
			},
		},
		RunStatusesByRoom: map[string][]api.RoomRunStatus{
			"room_general": {
				{
					RunID:        "run_1",
					RoomID:       "room_general",
					Agent:        api.RoomRunStatusAgentRef{ID: agent.ID, DisplayName: agent.DisplayName},
					Status:       "active",
					EventOrdinal: 2,
					CreatedAt:    now,
					UpdatedAt:    now,
				},
			},
		},
		PresentationByRun: map[string][]json.RawMessage{
			"run_1": {
				json.RawMessage(`{"event_ordinal":1,"type":"working_status_changed","status":"working","summary":"Inspecting repository"}`),
				json.RawMessage(`{"event_ordinal":2,"type":"activity_started","title":"Run test suite","tool":"shell"}`),
			},
		},
		WorkItems: []api.WorkItem{
			{
				ID:          "wi_1",
				TenantID:    "ten_1",
				Number:      12,
				Kind:        "task",
				Title:       "Ship Mobile Companion Wave B",
				Description: "Complete protocol client, SSE, mDNS, cache, and Connection Hub.",
				State:       "in_progress",
				Priority:    "high",
				Version:     1,
				CreatedBy:   human,
				UpdatedBy:   human,
				CreatedAt:   now,
				UpdatedAt:   now,
			},
		},
		RoutinesByRoom: map[string][]api.Routine{
			"room_general": {
				{
					ID:               "rt_1",
					RoomID:           "room_general",
					Name:             "Morning Standup Digest",
					Instruction:      "Summarize open Work Items and recent commits.",
					Enabled:          true,
					Revision:         1,
					CreatedByActorID: human.ID,
					CreatedAt:        now,
					UpdatedAt:        now,
				},
			},
		},
		PocketNotes: []api.PocketNote{
			{NoteDate: "2026-11-24", Body: "Check TLS pinning and mDNS radar on iPhone.", UpdatedAt: now},
		},
		Documents: []api.Document{
			{
				ID:                   "doc_1",
				TenantID:             "ten_1",
				Title:                "Mobile Companion Architecture",
				Format:               "markdown",
				RepresentationFormat: "markdown",
				Status:               "active",
				CanEditNativeContent: true,
				CreatedAt:            now,
				UpdatedAt:            now,
			},
		},
		Agents: []api.TenantAgent{
			{
				Actor:             api.Actor{ID: agent.ID, TenantID: "ten_1", Kind: "agent", DisplayName: agent.DisplayName, CreatedAt: now},
				AgentManagementID: "am_1",
				AgentType:         "pi",
				Description:       "Engineering companion agent",
				Instructions:      "Help review builds and run diagnostics.",
				VisibilityScope:   "workspace",
				CreatedBy:         human,
				CreatedAt:         now,
				UpdatedAt:         now,
			},
		},
		Computers: []api.LocalComputer{
			{
				ComputerID:       "comp_mac_1",
				DisplayName:      "Studio Mac",
				Status:           "online",
				ActiveOperations: 1,
				Runtimes:         []api.LocalComputerRuntime{{RuntimeType: "pi", Models: []string{"qwen3-4b:Q4_K_M"}}},
			},
		},
		LocalModels: api.LocalModelsView{
			Available:     true,
			Computer:      api.LocalModelsComputer{ComputerID: "comp_mac_1", DisplayName: "Studio Mac", Online: true},
			ViewerIsOwner: true,
			Pools:         []api.LocalModelPool{{ID: "unified", Label: "Unified Memory", TotalBytes: 32 << 30, UsedBytes: 6 << 30, FreeBytes: 26 << 30}},
			Models: []api.LocalModelView{
				{
					Model: api.LocalModel{
						ID:            "qwen3-4b:Q4_K_M",
						Name:          "Qwen3 4B",
						Description:   "Fast local coding model",
						Quant:         "Q4_K_M",
						Fit:           "unified",
						State:         "loaded",
						ContextTokens: 32768,
						DownloadBytes: 2600000000,
						MemoryBytes:   3400000000,
						Availability:  api.LocalModelAvailability{Available: true},
					},
				},
			},
		},
		ModelSource: api.ModelSourceView{
			ComputerID:    "comp_mac_1",
			Online:        true,
			ViewerIsOwner: true,
			Status: &api.ModelSourceStatus{
				Mode:         "local",
				Runtime:      "pi",
				RuntimeModel: "localmodels/qwen3-4b:Q4_K_M",
			},
		},
		ProactiveRules: api.ProactiveRuleBook{
			Version: 1,
			Rules: []api.ProactiveRule{
				{ID: "rule_1", Text: "Notify when CI fails on main", Status: "active", Source: "user", Mandate: "remind", Pinned: true},
			},
		},
		ExternalApps: api.ExternalAppList{
			ProviderConfigured: true,
			Apps: []api.ExternalApp{
				{Key: "github", DisplayName: "GitHub", Description: "Repositories and pull requests", Availability: "available"},
			},
		},
		WebSearchBackends: api.WebSearchBackendList{
			CanSaveKeys:   true,
			DefaultSearch: "duckduckgo",
			DefaultOpen:   "direct",
			Backends: []api.WebSearchBackend{
				{ID: "duckduckgo", Name: "DuckDuckGo", Description: "Keyless web search", Status: "ready", Tier: "free", KeyState: "not_required", Keyless: true},
			},
		},
		VoicePolicy: api.VoiceMediaPolicy{
			VoiceAvailable:      &voiceAvail,
			VoiceMediaSupported: true,
			LiveEnabled:         &liveEnabled,
		},
		VoiceSession: api.VoiceSession{
			ID:               "vs_1",
			TenantID:         "ten_1",
			RoomID:           "room_general",
			Purpose:          "capture",
			Status:           "active",
			CreatedByActorID: human.ID,
			CreatedAt:        now,
			UpdatedAt:        now,
		},
		VoiceCapture: api.VoiceCapture{
			ID:             "vc_1",
			VoiceSessionID: "vs_1",
			RoomID:         "room_general",
			Status:         "recording",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		AccountProfile: api.AccountProfile{
			Name:         "Alex Rivera",
			Email:        "alex@linger.dev",
			Bio:          "Building Linger Mobile",
			Organization: "Linger Labs",
		},
	}

	srv := httptest.NewUnstartedServer(http.HandlerFunc(fs.serveHTTP))
	if useTLS {
		cert, fp, err := generateSelfSignedECDSACert()
		if err != nil {
			return nil, err
		}
		fs.Fingerprint = fp
		shortCode, err := discovery.ShortFingerprint(fp)
		if err != nil {
			return nil, err
		}
		fs.ShortCode = shortCode
		srv.TLS = &tls.Config{
			MinVersion:   tls.VersionTLS13,
			Certificates: []tls.Certificate{cert},
		}
		srv.StartTLS()
	} else {
		srv.Start()
	}
	fs.Server = srv
	fs.URL = srv.URL
	return fs, nil
}

// Close shuts down the server and closes all active SSE subscribers.
func (f *FakeServer) Close() {
	f.mu.Lock()
	for ch := range f.sseSubs {
		close(ch)
		delete(f.sseSubs, ch)
	}
	for ch := range f.voiceSSESubs {
		close(ch)
		delete(f.voiceSSESubs, ch)
	}
	f.mu.Unlock()
	f.Server.Close()
}

// PushSSE pushes a live SSE frame to every connected /v0/events subscriber.
func (f *FakeServer) PushSSE(frame SSEFrame) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for ch := range f.sseSubs {
		select {
		case ch <- frame:
		default:
		}
	}
}

// PushVoiceSSE pushes a live SSE frame to every connected /v0/voice-sessions/:id/events/stream subscriber.
func (f *FakeServer) PushVoiceSSE(frame SSEFrame) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for ch := range f.voiceSSESubs {
		select {
		case ch <- frame:
		default:
		}
	}
}

// AppendRoomEvent stores a room event in the server's authoritative log (for backfill)
// and optionally broadcasts it on /v0/events.
func (f *FakeServer) AppendRoomEvent(ev api.RoomEventEnvelope, broadcast bool) {
	f.mu.Lock()
	f.RoomEventsByRoom[ev.RoomID] = append(f.RoomEventsByRoom[ev.RoomID], ev)
	f.mu.Unlock()
	if broadcast {
		raw, _ := json.Marshal(ev)
		f.PushSSE(SSEFrame{Event: "room.event", Data: string(raw)})
	}
}

// AppendPresentationEvent adds a runtime presentation event for runID.
func (f *FakeServer) AppendPresentationEvent(runID string, raw json.RawMessage) {
	f.mu.Lock()
	f.PresentationByRun[runID] = append(f.PresentationByRun[runID], raw)
	f.mu.Unlock()
}

func (f *FakeServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.RequestedEndpoints = append(f.RequestedEndpoints, r.Method+" "+r.URL.Path)
	if r.Header.Get("Origin") != "" {
		f.ObservedOrigin++
		if f.RejectCSRF {
			f.mu.Unlock()
			writeJSONError(w, http.StatusForbidden, "ORIGIN_REJECTED", "Origin header rejected by Companion Gateway")
			return
		}
	}
	if r.Header.Get("Sec-Fetch-Site") != "" {
		f.ObservedSecFetch++
		if f.RejectCSRF {
			f.mu.Unlock()
			writeJSONError(w, http.StatusForbidden, "SEC_FETCH_REJECTED", "Sec-Fetch-Site header rejected by Companion Gateway")
			return
		}
	}
	f.mu.Unlock()

	path := r.URL.Path
	switch {
	case path == "/companion/v1/info" && r.Method == http.MethodGet:
		f.handleCompanionInfo(w)
		return
	case path == "/companion/v1/pair" && r.Method == http.MethodPost:
		f.handleCompanionPair(w, r)
		return
	case path == "/v0/auth/login" && r.Method == http.MethodPost:
		f.handleLogin(w, r)
		return
	}

	if !f.authorized(r) {
		writeJSONError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication is invalid or expired")
		return
	}

	switch {
	case f.serveWaveC1Route(w, r):
		return
	case path == "/companion/v1/status" && r.Method == http.MethodGet:
		f.handleCompanionStatus(w)
	case path == "/companion/v1/token/rotate" && r.Method == http.MethodPost:
		f.handleTokenRotate(w)
	case path == "/companion/v1/unpair" && r.Method == http.MethodPost:
		f.handleUnpair(w)
	case path == "/v0/events" && r.Method == http.MethodGet:
		f.handleSSE(w, r)
	case strings.HasPrefix(path, "/v0/voice-sessions/") && strings.HasSuffix(path, "/events/stream") && r.Method == http.MethodGet:
		f.handleVoiceSSE(w, r)
	case path == "/v0/session" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		f.handleSession(w, r)
	case path == "/v0/auth/logout" && r.Method == http.MethodPost:
		w.WriteHeader(http.StatusNoContent)
	case path == "/v0/me" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.Identity)
	case path == "/v0/tenants" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.TenantList{Items: []api.Tenant{{ID: f.TenantID, Name: "Alex's Workspace", CreatedAt: time.Now().UTC()}}})
	case path == "/v0/tenants/"+f.TenantID+"/rooms" && r.Method == http.MethodGet:
		f.mu.Lock()
		rooms := append([]api.RoomListItem(nil), f.Rooms...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RoomListPage{Items: rooms})
	case path == "/v0/tenants/"+f.TenantID+"/room-activity" && r.Method == http.MethodGet:
		f.mu.Lock()
		runs := append([]api.RoomRunStatus(nil), f.RunStatusesByRoom["room_general"]...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.TenantRoomActivity{
			Items: []api.RoomActivityItem{{RoomID: "room_general", ActiveRuns: runs, PendingCount: 1}},
		})
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/messages") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/messages")
		f.mu.Lock()
		msgs := append([]api.Message(nil), f.MessagesByRoom[roomID]...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.MessagePage{Items: msgs, SnapshotRoomSeq: int64(len(msgs))})
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/messages") && r.Method == http.MethodPost:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/messages")
		var req api.CreateMessageRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		nextSeq := int64(len(f.MessagesByRoom[roomID]) + 1)
		msg := api.Message{
			ID:          fmt.Sprintf("msg_%d", nextSeq),
			TenantID:    f.TenantID,
			RoomID:      roomID,
			RoomSeq:     &nextSeq,
			Author:      api.ActorRef{ID: "act_human_1", TenantID: f.TenantID, Kind: "human", DisplayName: "Alex Rivera"},
			MessageKind: "conversation",
			RawMessage:  req.RawMessage,
			CreatedAt:   time.Now().UTC(),
		}
		f.MessagesByRoom[roomID] = append(f.MessagesByRoom[roomID], msg)
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, msg)
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/events") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/events")
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		f.mu.Lock()
		all := f.RoomEventsByRoom[roomID]
		var items []api.RoomEventEnvelope
		var latest int64
		for _, ev := range all {
			if ev.RoomSeq > latest {
				latest = ev.RoomSeq
			}
			if ev.RoomSeq > after {
				items = append(items, ev)
			}
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RoomEventPage{Items: items, HasMore: false, LatestRoomSeq: latest})
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/run-statuses") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/run-statuses")
		f.mu.Lock()
		runs := append([]api.RoomRunStatus(nil), f.RunStatusesByRoom[roomID]...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RoomRunStatusList{Items: runs})
	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/runs/") && strings.HasSuffix(path, "/runtime-presentation-events") && r.Method == http.MethodGet:
		parts := strings.Split(strings.Trim(path, "/"), "/")
		runID := ""
		if len(parts) >= 5 {
			runID = parts[4]
		}
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		f.mu.Lock()
		all := f.PresentationByRun[runID]
		var items []json.RawMessage
		var maxOrd int64
		for i, raw := range all {
			ord := int64(i + 1)
			var probe struct {
				EventOrdinal int64 `json:"event_ordinal"`
			}
			if json.Unmarshal(raw, &probe) == nil && probe.EventOrdinal > 0 {
				ord = probe.EventOrdinal
			}
			if ord > maxOrd {
				maxOrd = ord
			}
			if ord > after {
				items = append(items, raw)
			}
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RuntimePresentationEventPage{Items: items, PublishedThroughOrdinal: maxOrd})
	case strings.HasPrefix(path, "/v0/decisions/") && r.Method == http.MethodPost:
		var req api.DecisionRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		msg := f.MessagesByRoom["room_general"][1]
		if msg.Card != nil {
			msg.Card.Status = "approved"
			if req.Decision == "deny" {
				msg.Card.Status = "denied"
			}
			msg.Card.Version++
		}
		f.MessagesByRoom["room_general"][1] = msg
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, msg)
	case path == "/v0/tenants/"+f.TenantID+"/work-items" && r.Method == http.MethodGet:
		f.mu.Lock()
		items := append([]api.WorkItem(nil), f.WorkItems...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.WorkItemPage{Items: items})
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/routines") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/routines")
		f.mu.Lock()
		items := append([]api.Routine(nil), f.RoutinesByRoom[roomID]...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.RoutineList{Items: items})
	case path == "/v0/tenants/"+f.TenantID+"/me/pocket-notes" && r.Method == http.MethodGet:
		f.mu.Lock()
		items := append([]api.PocketNote(nil), f.PocketNotes...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.PocketNotePage{Today: "2026-11-24", Items: items})
	case path == "/v0/library/documents" && r.Method == http.MethodGet:
		f.mu.Lock()
		docs := append([]api.Document(nil), f.Documents...)
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.DocumentPage{Items: docs})
	case path == "/v0/tenants/"+f.TenantID+"/agents" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.TenantAgentPage{Items: f.Agents})
	case path == "/v0/tenants/"+f.TenantID+"/local-computers" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.LocalComputerPage{Items: f.Computers})
	case strings.HasSuffix(path, "/local-models") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.LocalModels)
	case strings.HasSuffix(path, "/model-source") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.ModelSource)
	case path == "/v0/tenants/"+f.TenantID+"/me/proactive-rules" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.ProactiveRules)
	case path == "/v0/external-apps" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.ExternalApps)
	case path == "/v0/web-search/backends" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.WebSearchBackends)
	case path == "/v0/tenants/"+f.TenantID+"/voice-media-policy" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.VoicePolicy)
	case path == "/v0/tenants/"+f.TenantID+"/account-profile" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, f.AccountProfile)
	default:
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "route not found: "+path)
	}
}

func (f *FakeServer) authorized(r *http.Request) bool {
	f.mu.Lock()
	tok := f.ValidToken
	cookie := f.ValidCookie
	f.mu.Unlock()

	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return tok != "" && strings.TrimPrefix(auth, "Bearer ") == tok
	}
	if ck, err := r.Cookie(api.SessionCookieName); err == nil {
		return cookie != "" && ck.Value == cookie
	}
	return false
}

func (f *FakeServer) handleCompanionInfo(w http.ResponseWriter) {
	f.mu.Lock()
	info := api.CompanionInfo{
		ProtocolVersion: 1,
		HostID:          f.HostID,
		HostName:        f.HostName,
		DesktopVersion:  f.DesktopVersion,
		PairingOpen:     f.PairingOpen,
		TLS:             f.TLS,
		TLSFingerprint:  f.Fingerprint,
		Addresses: api.CompanionAddresses{
			LAN:       []string{"127.0.0.1"},
			Tailscale: []string{"100.64.1.8"},
		},
	}
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, info)
}

func (f *FakeServer) handleCompanionPair(w http.ResponseWriter, r *http.Request) {
	var req api.PairRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.PairingOpen {
		writeJSONError(w, http.StatusForbidden, "PAIRING_CLOSED", "pairing window is closed")
		return
	}
	matched := (req.Code != "" && req.Code == f.PairCode) || (req.PIN != "" && req.PIN == f.PairPIN)
	if !matched {
		f.FailedPairCount++
		if f.FailedPairCount >= 5 {
			f.PairingOpen = false
		}
		writeJSONError(w, http.StatusUnauthorized, "INVALID_PAIRING_SECRET", "invalid pairing code or PIN")
		return
	}
	writeJSON(w, http.StatusOK, api.PairResponse{
		DeviceID:       f.DeviceID,
		Token:          f.ValidToken,
		HostID:         f.HostID,
		HostName:       f.HostName,
		TLSFingerprint: f.Fingerprint,
		TenantID:       f.TenantID,
		APIVersion:     "v0",
		SessionMode:    "dedicated",
	})
}

func (f *FakeServer) handleCompanionStatus(w http.ResponseWriter) {
	f.mu.Lock()
	st := api.CompanionStatus{
		HostID:             f.HostID,
		HostName:           f.HostName,
		DesktopVersion:     f.DesktopVersion,
		ComputerID:         "comp_mac_1",
		DaemonConnection:   "connected",
		RuntimeState:       "ready",
		ActiveOperations:   1,
		PreventSleep:       true,
		LocalServerPhase:   "running",
		ServerURLMode:      "local",
		DeviceID:           f.DeviceID,
		PairedDevicesCount: 1,
	}
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, st)
}

func (f *FakeServer) handleTokenRotate(w http.ResponseWriter) {
	f.mu.Lock()
	f.ValidToken = f.ValidToken + "_rot"
	resp := api.TokenRotateResponse{DeviceID: f.DeviceID, Token: f.ValidToken}
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, resp)
}

func (f *FakeServer) handleUnpair(w http.ResponseWriter) {
	f.mu.Lock()
	f.ValidToken = ""
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, api.UnpairResponse{Unpaired: true})
}

func (f *FakeServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req api.LoginRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Email != "alex@linger.dev" || req.Password != "linger-pass" {
		writeJSONError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}
	f.mu.Lock()
	ck := f.ValidCookie
	id := f.Identity
	f.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: api.SessionCookieName, Value: ck, Path: "/"})
	writeJSON(w, http.StatusOK, api.Session{
		ID:        "sess_1",
		AccountID: id.Account.ID,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		Identity:  id,
	})
}

func (f *FakeServer) handleSession(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	if r.Method == http.MethodPost {
		f.ValidCookie = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
		http.SetCookie(w, &http.Cookie{Name: api.SessionCookieName, Value: f.ValidCookie, Path: "/"})
	}
	id := f.Identity
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, api.Session{
		ID:        "sess_1",
		AccountID: id.Account.ID,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		Identity:  id,
	})
}

func (f *FakeServer) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no flusher", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	ch := make(chan SSEFrame, 32)
	f.mu.Lock()
	f.sseSubs[ch] = struct{}{}
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.sseSubs, ch)
		f.mu.Unlock()
	}()

	_, _ = fmt.Fprint(w, ": connected\n\nevent: stream.resync\ndata: {\"reason\":\"connected\"}\n\n")
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

func (f *FakeServer) handleVoiceSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no flusher", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	ch := make(chan SSEFrame, 32)
	f.mu.Lock()
	f.voiceSSESubs[ch] = struct{}{}
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.voiceSSESubs, ch)
		f.mu.Unlock()
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

func writeSSEFrame(w http.ResponseWriter, flusher http.Flusher, frame SSEFrame) {
	if frame.Comment != "" {
		_, _ = fmt.Fprintf(w, ": %s\n\n", frame.Comment)
		flusher.Flush()
		return
	}
	if frame.ID != "" {
		_, _ = fmt.Fprintf(w, "id: %s\n", frame.ID)
	}
	if frame.Event != "" {
		_, _ = fmt.Fprintf(w, "event: %s\n", frame.Event)
	}
	_, _ = fmt.Fprintf(w, "data: %s\n\n", frame.Data)
	flusher.Flush()
}

func extractMiddleSegment(path, prefix, suffix string) string {
	trimmed := strings.TrimPrefix(path, prefix)
	return strings.TrimSuffix(trimmed, suffix)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":       code,
			"message":    msg,
			"request_id": "req_fake_01",
		},
	})
}

func generateSelfSignedECDSACert() (tls.Certificate, string, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	if err != nil {
		return tls.Certificate{}, "", err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "Linger Desktop Companion Test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	fp := discovery.ComputeSPKIFingerprint(leaf.RawSubjectPublicKeyInfo)
	return tls.Certificate{
		Certificate: [][]byte{der},
		PrivateKey:  priv,
		Leaf:        leaf,
	}, fp, nil
}
