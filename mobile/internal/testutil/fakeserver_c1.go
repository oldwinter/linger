package testutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// SeedWaveC1Fixtures enriches FakeServer with rich Rooms, Threads, all 12
// Decision Cards, Mail Canvas, Agents/Skills/Templates, Computers, Local Models,
// Permissions, Browser Connection, and Runtime Presentation Events.
func (f *FakeServer) SeedWaveC1Fixtures() {
	f.mu.Lock()
	defer f.mu.Unlock()

	now := time.Date(2026, 11, 24, 15, 30, 0, 0, time.UTC)
	human := api.ActorRef{ID: "act_human_1", TenantID: f.TenantID, Kind: "human", DisplayName: "Alex Rivera"}
	scout := api.ActorRef{ID: "act_agent_1", TenantID: f.TenantID, Kind: "agent", DisplayName: "Scout"}
	builder := api.ActorRef{ID: "act_agent_2", TenantID: f.TenantID, Kind: "agent", DisplayName: "Builder"}

	// Add a Direct Room and a second Group Room alongside Product Launch.
	f.Rooms = append(f.Rooms,
		api.RoomListItem{
			ID:                 "room_dm_scout",
			TenantID:           f.TenantID,
			Kind:               "direct",
			Name:               "Scout",
			DirectPeer:         &scout,
			CreatedBy:          human,
			LatestRoomSeq:      2,
			ReadThroughRoomSeq: 2,
			UnreadMessageCount: 0,
			MemberPreview:      []api.ActorRef{human, scout},
			LatestMessage: &api.LatestMessageSummary{
				ID:         "msg_dm_2",
				RoomSeq:    2,
				RawMessage: "All local models are warm and ready.",
				Author:     scout,
				CreatedAt:  now.Add(-2 * time.Minute),
			},
			CreatedAt: now.Add(-2 * time.Hour),
			UpdatedAt: now.Add(-2 * time.Minute),
		},
		api.RoomListItem{
			ID:                 "room_ops",
			TenantID:           f.TenantID,
			Kind:               "group",
			Name:               "Release Ops",
			CreatedBy:          human,
			LatestRoomSeq:      1,
			ReadThroughRoomSeq: 0,
			UnreadMessageCount: 1,
			MemberPreview:      []api.ActorRef{human, scout, builder},
			LatestMessage: &api.LatestMessageSummary{
				ID:         "msg_ops_1",
				RoomSeq:    1,
				RawMessage: "Waiting for approval on outbound status email.",
				Author:     builder,
				CreatedAt:  now.Add(-1 * time.Minute),
			},
			CreatedAt: now.Add(-3 * time.Hour),
			UpdatedAt: now.Add(-1 * time.Minute),
		},
	)

	// Rich decision payloads for runtime_permission (with diff + screenshot),
	// connector_write, and question cards in room_general & room_ops.
	patchText := "--- a/mobile/cmd/main.go\n+++ b/mobile/cmd/main.go\n@@ -1,3 +1,4 @@\n package main\n+// verified by agent\n func main() {}\n"
	rtPermView, _ := json.Marshal(api.RuntimePermissionDecisionView{
		Kind:      "code",
		Tool:      "shell.exec",
		Title:     "Run go test in linger-mobile",
		Rationale: "Verifies unit tests pass before committing Wave C-1.",
		Input:     `{"cmd":"go test -race ./...","cwd":"mobile"}`,
		Patch:     &patchText,
		Screenshot: &api.RuntimePermissionScreenshot{
			URL:    "/v0/decisions/dec_1/screenshot",
			Width:  120,
			Height: 80,
		},
	})
	if len(f.MessagesByRoom["room_general"]) >= 2 && f.MessagesByRoom["room_general"][1].Card != nil {
		f.MessagesByRoom["room_general"][1].Card.RuntimePermission = rtPermView
	}

	// Add a Question card and HTML fragment message to room_general.
	seq3, seq4 := int64(3), int64(4)
	qView, _ := json.Marshal(api.QuestionDecisionView{
		Questions: []api.DecisionQuestion{
			{
				ID:     "q_target",
				Prompt: "Which release channel should we publish to?",
				Input:  "single_select",
				Options: []api.DecisionQuestionOption{
					{ID: "beta", Label: "TestFlight Beta"},
					{ID: "prod", Label: "Production Store"},
				},
			},
		},
	})
	f.MessagesByRoom["room_general"] = append(f.MessagesByRoom["room_general"],
		api.Message{
			ID:          "msg_3",
			TenantID:    f.TenantID,
			RoomID:      "room_general",
			RoomSeq:     &seq3,
			Author:      scout,
			MessageKind: "conversation",
			RawMessage:  "Please pick the rollout target before I cut the build.",
			Card: &api.DecisionRequestedMessageCard{
				CardType:      "decision_requested",
				DecisionID:    "dec_question_1",
				Kind:          "question",
				Status:        "pending",
				Title:         "Confirm rollout channel",
				Intent:        "Choose target distribution channel",
				Version:       1,
				Requester:     api.MessageCardActorRef{ID: scout.ID, Kind: "agent", DisplayName: scout.DisplayName},
				DecisionOwner: api.MessageCardActorRef{ID: human.ID, Kind: "human", DisplayName: human.DisplayName},
				Question:      qView,
			},
			Thread:    &api.MessageThreadSummary{ThreadRoomID: "thread_msg_3", ReplyCount: 1},
			CreatedAt: now.Add(-3 * time.Minute),
		},
		api.Message{
			ID:          "msg_4",
			TenantID:    f.TenantID,
			RoomID:      "room_general",
			RoomSeq:     &seq4,
			Author:      scout,
			MessageKind: "conversation",
			RawMessage:  "Rendered release metrics widget.",
			Segments: []api.MessageSegment{
				{Type: "text", Content: "Rendered release metrics widget."},
				{Type: "html_fragment", Content: "Release Metrics", HTML: "<div><h3>Release Ready</h3><p>Pass rate: 100%</p></div>"},
			},
			CreatedAt: now.Add(-1 * time.Minute),
		},
	)

	// Seed connector_write card in room_ops.
	subj := "Linger Mobile Wave C-1 Ready"
	cwView, _ := json.Marshal(api.ConnectorWriteDecisionView{
		Kind:    "message",
		App:     "gmail",
		Account: "alex@linger.dev",
		Tool:    "gmail.send_email",
		Title:   "Send release update email",
		Input:   `{"to":["team@linger.dev"],"subject":"Linger Mobile Wave C-1 Ready"}`,
		Message: &api.ConnectorConfirmationMessage{
			Format:  "plain",
			To:      []string{"team@linger.dev"},
			Subject: &subj,
			Body:    "Wave C-1 Rooms & Live Ops screens passed verification.",
		},
	})
	opsSeq := int64(1)
	f.MessagesByRoom["room_ops"] = []api.Message{
		{
			ID:          "msg_ops_1",
			TenantID:    f.TenantID,
			RoomID:      "room_ops",
			RoomSeq:     &opsSeq,
			Author:      builder,
			MessageKind: "conversation",
			RawMessage:  "Waiting for approval on outbound status email.",
			Card: &api.DecisionRequestedMessageCard{
				CardType:       "decision_requested",
				DecisionID:     "dec_cw_1",
				Kind:           "connector_write",
				Status:         "pending",
				Title:          "Send release update email",
				Intent:         "Notify engineering team",
				Version:        1,
				Requester:      api.MessageCardActorRef{ID: builder.ID, Kind: "agent", DisplayName: builder.DisplayName},
				DecisionOwner:  api.MessageCardActorRef{ID: human.ID, Kind: "human", DisplayName: human.DisplayName},
				ConnectorWrite: cwView,
			},
			CreatedAt: now.Add(-1 * time.Minute),
		},
	}

	// Seed Thread messages.
	tSeq := int64(1)
	f.MessagesByRoom["thread_msg_3"] = []api.Message{
		{
			ID:          "msg_t_1",
			TenantID:    f.TenantID,
			RoomID:      "thread_msg_3",
			RoomSeq:     &tSeq,
			Author:      human,
			MessageKind: "conversation",
			RawMessage:  "Let's start with TestFlight Beta first.",
			CreatedAt:   now.Add(-2 * time.Minute),
		},
	}

	// Enrich run_1 presentation events with TeamHub's nested {event_ordinal, segment_id, event: {...}} shape.
	f.PresentationByRun["run_1"] = []json.RawMessage{
		json.RawMessage(`{"event_ordinal":1,"segment_id":"seg_1","event":{"type":"working_status_changed","status":"thinking","title":"Planning Wave C-1 checks"}}`),
		json.RawMessage(`{"event_ordinal":2,"segment_id":"seg_1","event":{"type":"plan_updated","explanation":"Verify mobile packages","steps":[{"content":"Check OpenAPI DTOs","status":"completed"},{"content":"Run race tests","status":"in_progress"},{"content":"Build release binary","status":"pending"}]}}`),
		json.RawMessage(`{"event_ordinal":3,"segment_id":"seg_1","event":{"type":"activity_started","activity_id":"act_run_1","kind":"command","title":"go test -race ./..."}}`),
		json.RawMessage(`{"event_ordinal":4,"segment_id":"seg_1","event":{"type":"activity_updated","activity_id":"act_run_1","detail":"Testing internal/screens/rooms and internal/screens/live"}}`),
		json.RawMessage(`{"event_ordinal":5,"segment_id":"seg_1","event":{"type":"activity_finished","activity_id":"act_run_1","outcome":"succeeded","content":[{"kind":"code","text":"ok github.com/oldwinter/linger/mobile/internal/api 1.2s"}]}}`),
		json.RawMessage(`{"event_ordinal":6,"segment_id":"seg_1","event":{"type":"presentation_output_created","output_id":"out_1","output_kind":"text","text":"All **12 decision cards** and **Live Ops** checks look green."}}`),
	}

	// Add second agent & second downloadable local model for Make Room & Load testing.
	f.Agents = append(f.Agents, api.TenantAgent{
		Actor:                 api.Actor{ID: builder.ID, TenantID: f.TenantID, Kind: "agent", DisplayName: "Builder", CreatedAt: now},
		AgentManagementID:     "am_2",
		AgentType:             "pi",
		ConfigurationRevision: 1,
		Description:           "Release automation specialist",
		Instructions:          "Coordinate builds and deployments.",
		Runtime:               api.AgentRuntimeConfig{Model: "localmodels/qwen3-4b:Q4_K_M"},
		VisibilityScope:       "workspace",
		CreatedBy:             human,
		CreatedAt:             now,
		UpdatedAt:             now,
	})
	f.LocalModels.Models = append(f.LocalModels.Models, api.LocalModelView{
		Model: api.LocalModel{
			ID:            "llama3.3-8b:Q4_K_M",
			Name:          "Llama 3.3 8B",
			Description:   "General-purpose local reasoning model",
			Quant:         "Q4_K_M",
			Fit:           "unified",
			State:         "idle",
			ContextTokens: 65536,
			DownloadBytes: 4900000000,
			MemoryBytes:   6200000000,
			Availability:  api.LocalModelAvailability{Downloadable: true},
		},
	})
}

func (f *FakeServer) serveWaveC1Route(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	now := time.Now().UTC()
	human := api.ActorRef{ID: "act_human_1", TenantID: f.TenantID, Kind: "human", DisplayName: "Alex Rivera"}

	switch {
	// Decision screenshot -> valid 1x1 PNG
	case strings.HasPrefix(path, "/v0/decisions/") && strings.HasSuffix(path, "/screenshot") && r.Method == http.MethodGet:
		img := image.NewRGBA(image.Rect(0, 0, 12, 12))
		for y := 0; y < 12; y++ {
			for x := 0; x < 12; x++ {
				img.Set(x, y, color.RGBA{R: 9, G: 118, B: 206, A: 255})
			}
		}
		var buf bytes.Buffer
		_ = png.Encode(&buf, img)
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
		return true

	// Decision submit across ALL rooms/cards
	case strings.HasPrefix(path, "/v0/decisions/") && r.Method == http.MethodPost:
		decisionID := strings.TrimPrefix(path, "/v0/decisions/")
		var req api.DecisionRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		defer f.mu.Unlock()
		for roomID, msgs := range f.MessagesByRoom {
			for i := range msgs {
				if msgs[i].Card != nil && msgs[i].Card.DecisionID == decisionID {
					card := msgs[i].Card
					switch req.Decision {
					case "approve":
						card.Status = "approved"
					case "deny":
						card.Status = "denied"
					case "submit", "connected", "done", "skipped":
						card.Status = "answered"
					default:
						card.Status = req.Decision
					}
					card.Version++
					card.Answer = &api.DecisionAnswer{
						Decision:     req.Decision,
						Comment:      req.Comment,
						ConnectionID: req.ConnectionID,
						Answers:      req.Answers,
					}
					msgs[i].Card = card
					f.MessagesByRoom[roomID] = msgs
					writeJSON(w, http.StatusOK, msgs[i])
					return true
				}
			}
		}
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "decision not found: "+decisionID)
		return true

	// Create room (strict HumanRoomCreateRequest)
	case path == "/v0/tenants/"+f.TenantID+"/rooms" && r.Method == http.MethodPost:
		var body struct {
			Name        string  `json:"name"`
			Description *string `json:"description"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid room create request")
			return true
		}
		f.mu.Lock()
		id := fmt.Sprintf("room_%d", len(f.Rooms)+1)
		item := api.RoomListItem{
			ID: id, TenantID: f.TenantID, Kind: "group", Name: body.Name, Description: body.Description,
			CreatedBy: human, CreatedAt: now, UpdatedAt: now,
		}
		f.Rooms = append([]api.RoomListItem{item}, f.Rooms...)
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, api.Room{ID: id, TenantID: f.TenantID, Kind: "group", Name: body.Name, Description: body.Description, CreatedBy: human, CreatedAt: now, UpdatedAt: now})
		return true

	// Open direct room
	case path == "/v0/tenants/"+f.TenantID+"/direct-rooms" && r.Method == http.MethodPost:
		var body struct {
			PeerActorID string `json:"peer_actor_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		id := "room_dm_" + body.PeerActorID
		writeJSON(w, http.StatusOK, api.Room{ID: id, TenantID: f.TenantID, Kind: "direct", Name: "Direct Chat", CreatedBy: human, CreatedAt: now, UpdatedAt: now})
		return true

	// Room pin / read-state / participation / presence / patch / delete
	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/pin") && r.Method == http.MethodPut:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/pin")
		var body struct {
			Pinned bool `json:"pinned"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		for i := range f.Rooms {
			if f.Rooms[i].ID == roomID {
				if body.Pinned {
					t := now
					f.Rooms[i].PinnedAt = &t
				} else {
					f.Rooms[i].PinnedAt = nil
				}
			}
		}
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/read-state") && r.Method == http.MethodPut:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/read-state")
		var body struct {
			ThroughRoomSeq int64 `json:"through_room_seq"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "through_room_seq is required")
			return true
		}
		f.mu.Lock()
		for i := range f.Rooms {
			if f.Rooms[i].ID == roomID {
				f.Rooms[i].ReadThroughRoomSeq = body.ThroughRoomSeq
				f.Rooms[i].UnreadMessageCount = 0
			}
		}
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/participation") && r.Method == http.MethodPut:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/participation")
		var body struct {
			Status string `json:"status"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		for i := range f.Rooms {
			if f.Rooms[i].ID == roomID {
				st := body.Status
				f.Rooms[i].Participation = &st
			}
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, api.Room{ID: roomID, TenantID: f.TenantID, Participation: &body.Status})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/presence") && r.Method == http.MethodPost:
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/members") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/members")
		writeJSON(w, http.StatusOK, api.RoomMemberPage{
			Items: []api.RoomMember{
				{RoomID: roomID, Actor: human, AddedBy: human, Role: "owner", JoinedAt: now, UpdatedAt: now},
				{RoomID: roomID, Actor: api.ActorRef{ID: "act_agent_1", TenantID: f.TenantID, Kind: "agent", DisplayName: "Scout"}, AddedBy: human, Role: "member", JoinedAt: now, UpdatedAt: now},
			},
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/members/") && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return true
		}
		writeJSON(w, http.StatusOK, api.RoomMember{Actor: human, Role: "member", JoinedAt: now, UpdatedAt: now})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/pins") && r.Method == http.MethodGet:
		roomID := extractMiddleSegment(path, "/v0/rooms/", "/pins")
		f.mu.Lock()
		type pinItem struct {
			Message         api.Message `json:"message"`
			PinnedAt        time.Time   `json:"pinned_at"`
			PinnedByActorID string      `json:"pinned_by_actor_id"`
		}
		var pinned []pinItem
		if len(f.MessagesByRoom[roomID]) > 0 {
			pinned = append(pinned, pinItem{
				Message:         f.MessagesByRoom[roomID][0],
				PinnedAt:        now,
				PinnedByActorID: human.ID,
			})
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"items": pinned})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/documents") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.DocumentPage{Items: f.Documents})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/team-md") && r.Method == http.MethodGet:
		role := "Lead release coordinator"
		writeJSON(w, http.StatusOK, api.TeamMdDocument{
			CollaboratePattern: "hub_and_spoke",
			TaskGoal:           "Ship Linger Mobile Companion with full verification",
			Orchestrator:       api.TeamMdParticipant{ActorID: "act_agent_1", Name: "Scout", Role: &role},
			RawMarkdown:        "# Team Charter\n\n- **Scout** coordinates releases.\n- **Builder** validates builds.",
			Revision:           1,
			UpdatedAt:          now,
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/history-shares") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.RoomHistorySharePage{
			Items: []api.RoomHistoryShare{{ID: "share_1", RoomName: "Product Launch", MessageCount: 4, SnapshotRoomSeq: 4, Revoked: false, CreatedAt: now}},
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/history-shares/create") && r.Method == http.MethodPost:
		var body struct {
			WebVersion *string `json:"web_version"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid history share request")
			return true
		}
		tok := "share_tok_1"
		writeJSON(w, http.StatusCreated, api.RoomHistoryShare{ID: "share_new", RoomName: "Product Launch", MessageCount: 4, SnapshotRoomSeq: 4, Revoked: false, Token: &tok, CreatedAt: now})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/history-shares/") && r.Method == http.MethodDelete:
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/thread") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusOK, api.Room{ID: "thread_msg_3", TenantID: f.TenantID, Kind: "thread", Name: "Thread", CreatedBy: human, CreatedAt: now, UpdatedAt: now})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/reactions/") && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/pin") && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/forward") && r.Method == http.MethodPost:
		var req struct {
			Target struct {
				Kind string `json:"kind"`
				ID   string `json:"id"`
			} `json:"target"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.Target.Kind == "" || req.Target.ID == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "forward target is invalid")
			return true
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"room_id":          req.Target.ID,
			"room_binding_ids": []string{},
			"message":          api.Message{ID: "msg_fwd_1", RoomID: req.Target.ID, RawMessage: "Forwarded message", Author: human, CreatedAt: now},
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/message-attachment-uploads") && r.Method == http.MethodPost:
		_ = r.ParseMultipartForm(4 << 20)
		fname := r.FormValue("filename")
		if fname == "" {
			fname = "upload.png"
		}
		writeJSON(w, http.StatusCreated, api.MessageAttachmentUpload{
			ID: "up_1", Filename: fname, MediaType: r.FormValue("media_type"), SizeBytes: 128, Status: "ready", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/message-attachment-uploads/") && r.Method == http.MethodDelete:
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/runs/") && strings.HasSuffix(path, "/cancel") && r.Method == http.MethodPost:
		var body struct {
			RequestID string `json:"request_id"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil || strings.TrimSpace(body.RequestID) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "request_id is required")
			return true
		}
		roomID := strings.Split(strings.Trim(path, "/"), "/")[2]
		runID := strings.Split(strings.Trim(path, "/"), "/")[4]
		f.mu.Lock()
		for i := range f.RunStatusesByRoom[roomID] {
			if f.RunStatusesByRoom[roomID][i].RunID == runID {
				f.RunStatusesByRoom[roomID][i].Status = "aborted"
			}
		}
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/runs/") && strings.HasSuffix(path, "/redeliver-unconfirmed-inputs") && r.Method == http.MethodPost:
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/background-tasks") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.RoomBackgroundTaskList{
			Items: []api.RoomBackgroundTask{{ID: "bg_1", Title: "Audit dependency tree", Requirement: "Check licenses", CreatedAt: now}},
		})
		return true

	case strings.HasPrefix(path, "/v0/rooms/") && strings.Contains(path, "/background-tasks/") && strings.HasSuffix(path, "/cancel") && r.Method == http.MethodPost:
		w.WriteHeader(http.StatusNoContent)
		return true

	// Mail Canvas
	case strings.HasPrefix(path, "/v0/documents/") && strings.HasSuffix(path, "/mail") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.MailCanvasState{
			To: "team@linger.dev", Subject: "Weekly Mobile Companion Digest", Body: "All Wave C-1 checks passed.",
			Status: "draft", SourceDigest: "sha256:mail_digest_1", CanEdit: true,
		})
		return true

	case strings.HasPrefix(path, "/v0/documents/") && strings.HasSuffix(path, "/mail") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusAccepted, api.MailCanvasState{
			To: "team@linger.dev", Subject: "Weekly Mobile Companion Digest", Status: "sent", SourceDigest: "sha256:mail_digest_1", CanEdit: false,
		})
		return true

	case strings.HasPrefix(path, "/v0/documents/") && strings.HasSuffix(path, "/mail/decline") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusOK, api.MailCanvasState{
			To: "team@linger.dev", Subject: "Weekly Mobile Companion Digest", Status: "declined", SourceDigest: "sha256:mail_digest_1", CanEdit: false,
		})
		return true

	// Agents, Availability, Skills & Templates
	case path == "/v0/tenants/"+f.TenantID+"/actors" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.ActorPage{Items: []api.Actor{
			{ID: "act_human_1", TenantID: f.TenantID, Kind: "human", DisplayName: "Alex Rivera", CreatedAt: now},
			{ID: "act_agent_1", TenantID: f.TenantID, Kind: "agent", DisplayName: "Scout", CreatedAt: now},
			{ID: "act_agent_2", TenantID: f.TenantID, Kind: "agent", DisplayName: "Builder", CreatedAt: now},
		}})
		return true

	case path == "/v0/tenants/"+f.TenantID+"/agent-availability" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.TenantAgentAvailabilityPage{
			Items: []api.TenantAgentAvailabilitySnapshot{
				{ActorID: "act_agent_1", Availability: api.TenantAgentAvailability{Status: "working", Label: "Running tests"}},
				{ActorID: "act_agent_2", Availability: api.TenantAgentAvailability{Status: "ready", Label: "Available"}},
			},
		})
		return true

	case path == "/v0/tenants/"+f.TenantID+"/agents" && r.Method == http.MethodPost:
		var body struct {
			Name         string `json:"name"`
			Description  string `json:"description"`
			Instructions string `json:"instructions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		ag := api.TenantAgent{
			Actor:                 api.Actor{ID: fmt.Sprintf("act_agent_%d", len(f.Agents)+1), TenantID: f.TenantID, Kind: "agent", DisplayName: body.Name, CreatedAt: now},
			AgentManagementID:     fmt.Sprintf("am_%d", len(f.Agents)+1),
			AgentType:             "pi",
			ConfigurationRevision: 1,
			Description:           body.Description,
			Instructions:          body.Instructions,
			CreatedBy:             human,
			CreatedAt:             now,
			UpdatedAt:             now,
		}
		f.Agents = append(f.Agents, ag)
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, ag)
		return true

	case strings.HasPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/") && !strings.Contains(strings.TrimPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/"), "/") && r.Method == http.MethodPatch:
		agentID := strings.TrimPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/")
		var body struct {
			Name         *string `json:"name"`
			Description  *string `json:"description"`
			Instructions *string `json:"instructions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		for i := range f.Agents {
			if f.Agents[i].Actor.ID == agentID || f.Agents[i].AgentManagementID == agentID {
				if body.Name != nil {
					f.Agents[i].Actor.DisplayName = *body.Name
				}
				if body.Description != nil {
					f.Agents[i].Description = *body.Description
				}
				if body.Instructions != nil {
					f.Agents[i].Instructions = *body.Instructions
				}
				f.Agents[i].ConfigurationRevision++
				out := f.Agents[i]
				f.mu.Unlock()
				writeJSON(w, http.StatusOK, out)
				return true
			}
		}
		f.mu.Unlock()
		writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return true

	case strings.HasPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/") && !strings.Contains(strings.TrimPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/"), "/") && r.Method == http.MethodDelete:
		agentID := strings.TrimPrefix(path, "/v0/tenants/"+f.TenantID+"/agents/")
		f.mu.Lock()
		next := f.Agents[:0]
		for _, ag := range f.Agents {
			if ag.Actor.ID != agentID && ag.AgentManagementID != agentID {
				next = append(next, ag)
			}
		}
		f.Agents = next
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return true

	case strings.HasSuffix(path, "/skill-manifests") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.SkillManifestPage{
			Items: []api.SkillManifest{
				{SkillID: "skill.git-review", Name: "git-review", Description: "Review branches and PR diffs", ManifestVersion: "1.0.0", Availability: "enabled"},
				{SkillID: "skill.web-research", Name: "web-research", Description: "Gather primary source docs", ManifestVersion: "1.2.0", Availability: "enabled"},
			},
		})
		return true

	case strings.HasSuffix(path, "/skill-bindings") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []api.AgentSkillBinding{}})
		return true

	case strings.Contains(path, "/skill-bindings/") && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		if r.Method == http.MethodDelete {
			ver := strings.TrimSpace(r.URL.Query().Get("expected_binding_version"))
			if ver == "" || ver == "0" {
				writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "expected_binding_version is required")
				return true
			}
			w.WriteHeader(http.StatusNoContent)
			return true
		}
		var req api.AgentSkillBindingPutRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.ExpectedBindingVersion < 1 || strings.TrimSpace(req.ManifestVersion) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid skill binding request")
			return true
		}
		writeJSON(w, http.StatusOK, api.AgentSkillBinding{ID: "bind_1", BindingVersion: req.ExpectedBindingVersion + 1, Enabled: req.Enabled})
		return true

	case strings.HasSuffix(path, "/agent-templates") && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, api.AgentTemplatePage{
			Items: []api.AgentTemplate{
				{TemplateID: "tpl_reviewer", Name: "Code Reviewer", Description: "Reviews PRs for security and style", Instructions: "Review diffs carefully.", Origin: "builtin"},
			},
		})
		return true

	// Local Computer Permissions, Browser Connection, Skill Scan, Local Models Actions, Model Source/BYOK
	case strings.HasSuffix(path, "/permissions") && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		writeJSON(w, http.StatusOK, api.ComputerPermissionStatus{
			Host: "desktop", Platform: "darwin",
			Subjects: []api.ComputerPermissionSubjectStatus{
				{Subject: "linger", Permissions: []api.ComputerPermissionEntry{
					{ID: "screen_recording", State: "granted", Prompt: "available"},
					{ID: "accessibility", State: "denied", Prompt: "settings_only"},
				}},
			},
		})
		return true

	case strings.HasSuffix(path, "/browser-connection") && (r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodDelete):
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return true
		}
		profile := "Default"
		browser := "chrome"
		writeJSON(w, http.StatusOK, api.BrowserConnectionStatus{
			Mode: "extension", Platform: "darwin", State: "connected", Browser: &browser, Profile: &profile,
		})
		return true

	case strings.HasSuffix(path, "/skill-scans") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusOK, map[string]any{"scanned": 2})
		return true

	case strings.HasSuffix(path, "/local-models") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusAccepted, map[string]any{"accepted": true})
		return true

	case strings.Contains(path, "/local-models/") && strings.HasSuffix(path, "/actions") && r.Method == http.MethodPost:
		parts := strings.Split(strings.Trim(path, "/"), "/")
		modelID := ""
		if len(parts) >= 2 {
			modelID = parts[len(parts)-2]
		}
		var body struct {
			Action      string   `json:"action"`
			UnloadFirst []string `json:"unload_first"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		for i := range f.LocalModels.Models {
			m := &f.LocalModels.Models[i].Model
			for _, u := range body.UnloadFirst {
				if m.ID == u {
					m.State = "idle"
				}
			}
			if m.ID == modelID {
				switch body.Action {
				case "load":
					m.State = "loaded"
				case "unload":
					m.State = "idle"
				case "pull":
					m.State = "downloading"
					m.Download = &api.LocalModelDownloadProgress{DoneBytes: m.DownloadBytes / 2, TotalBytes: m.DownloadBytes, Step: "downloading"}
				case "cancel_pull", "remove":
					m.State = "absent"
					m.Download = nil
				}
			}
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]any{"action": body.Action, "model_id": modelID})
		return true

	case strings.HasSuffix(path, "/model-source") && r.Method == http.MethodPost:
		var req api.ModelSourceSwitchRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || strings.TrimSpace(req.Mode) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid model source switch request")
			return true
		}
		f.mu.Lock()
		if f.ModelSource.Status == nil {
			f.ModelSource.Status = &api.ModelSourceStatus{}
		}
		f.ModelSource.Status.Mode = req.Mode
		if req.Byok != nil && req.Byok.ModelID != "" {
			f.ModelSource.Status.RuntimeModel = req.Byok.ModelID
		} else if req.LocalModelID != nil && *req.LocalModelID != "" {
			f.ModelSource.Status.RuntimeModel = *req.LocalModelID
		}
		out := f.ModelSource
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, out)
		return true

	case strings.HasSuffix(path, "/model-source/test") && r.Method == http.MethodPost:
		writeJSON(w, http.StatusOK, api.ByokTestResult{
			Ok: true, ModelID: "gpt-4o-mini", Protocol: "openai_chat_completions", URL: "https://api.openai.com/v1/chat/completions", ContextWindow: 128000,
		})
		return true

	case strings.HasSuffix(path, "/model-source/models") && r.Method == http.MethodPost:
		name1 := "GPT-4o Mini"
		name2 := "Claude 3.7 Sonnet"
		writeJSON(w, http.StatusOK, api.ByokModelList{
			URL: "https://api.openai.com/v1/models",
			Models: []api.ByokModel{
				{ID: "gpt-4o-mini", Name: &name1},
				{ID: "claude-3-7-sonnet", Name: &name2},
			},
		})
		return true
	}
	return false
}
