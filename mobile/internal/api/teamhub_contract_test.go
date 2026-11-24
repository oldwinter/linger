package api_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/discovery"
)

func decodeStrict(t *testing.T, r *http.Request, dst any) {
	t.Helper()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		t.Fatalf("%s %s: strict JSON decode failed (TeamHub DisallowUnknownFields): %v", r.Method, r.URL.Path, err)
	}
}

// TestRealTeamHubWireContractsStrict validates all 15 Phase 4B TeamHub API
// contracts against strict DisallowUnknownFields decoders matching
// apps/teamhub/internal/app/ and contracts/generated/go/teamhubpublic/openapi.gen.go.
func TestRealTeamHubWireContractsStrict(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339)

	var mu sync.Mutex
	var invitedMembers []string
	var deletedSkillQuery string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		// P0-4b: POST /v0/auth/login -> {"identifier", "password"}
		case r.Method == http.MethodPost && r.URL.Path == "/v0/auth/login":
			var req struct {
				Identifier string `json:"identifier"`
				Password   string `json:"password"`
			}
			decodeStrict(t, r, &req)
			if req.Identifier != "alex@linger.dev" || req.Password != "secret-pass" {
				t.Fatalf("unexpected login payload: %+v", req)
			}
			http.SetCookie(w, &http.Cookie{Name: api.SessionCookieName, Value: "sess_cookie_val", Path: "/"})
			_, _ = w.Write([]byte(`{"id":"s1","account_id":"acc_1","created_at":"` + now + `","expires_at":"` + now + `","identity":{"account":{"id":"acc_1","email":"alex@linger.dev","display_name":"Alex","created_at":"` + now + `"},"actors":[]}}`))

		// P0-4a: POST /v0/rooms/:roomId/messages -> {"raw_message", "segments" (non-nil), "context_message_ids", "attachment_upload_ids"}
		case r.Method == http.MethodPost && r.URL.Path == "/v0/rooms/room_1/messages":
			var req struct {
				RawMessage          string               `json:"raw_message"`
				Segments            []api.MessageSegment `json:"segments"`
				ContextMessageIDs   []string             `json:"context_message_ids"`
				AttachmentUploadIDs []string             `json:"attachment_upload_ids"`
			}
			decodeStrict(t, r, &req)
			if req.Segments == nil || len(req.Segments) != 1 || req.Segments[0].Type != "text" || req.Segments[0].Content != "Hello TeamHub" {
				t.Fatalf("expected structured text segment, got %+v", req.Segments)
			}
			if len(req.ContextMessageIDs) != 1 || req.ContextMessageIDs[0] != "msg_prev" {
				t.Fatalf("expected context_message_ids=[msg_prev], got %+v", req.ContextMessageIDs)
			}
			_, _ = w.Write([]byte(`{"id":"msg_99","tenant_id":"ten_1","room_id":"room_1","room_seq":9,"author":{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"},"message_kind":"conversation","raw_message":"Hello TeamHub","segments":[{"type":"text","content":"Hello TeamHub"}],"attachments":[],"reactions":[{"reaction_id":"thumbs_up","actor_ids":["act_1","act_2"]}],"created_at":"` + now + `"}`))

		// P1-6 #1: PUT /v0/rooms/:roomId/read-state -> {"through_room_seq"}
		case r.Method == http.MethodPut && r.URL.Path == "/v0/rooms/room_1/read-state":
			var req struct {
				ThroughRoomSeq int64 `json:"through_room_seq"`
			}
			decodeStrict(t, r, &req)
			if req.ThroughRoomSeq != 42 {
				t.Fatalf("expected through_room_seq=42, got %d", req.ThroughRoomSeq)
			}
			w.WriteHeader(http.StatusNoContent)

		// P1-6 #2: POST /v0/rooms/:roomId/runs/:runId/cancel -> non-empty {"request_id"}
		case r.Method == http.MethodPost && r.URL.Path == "/v0/rooms/room_1/runs/run_7/cancel":
			var req struct {
				RequestID string `json:"request_id"`
			}
			decodeStrict(t, r, &req)
			if strings.TrimSpace(req.RequestID) == "" {
				t.Fatal("cancel run request_id must be non-empty")
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"run_id":"run_7","status":"cancel_requested"}`))

		// P1-6 #3: POST /v0/rooms/:roomId/messages/:messageId/forward -> {"target":{"kind":"room","id":...}} & return {"message":...,"room_id":...}
		case r.Method == http.MethodPost && r.URL.Path == "/v0/rooms/room_1/messages/msg_99/forward":
			var req struct {
				Target struct {
					Kind string `json:"kind"`
					ID   string `json:"id"`
				} `json:"target"`
			}
			decodeStrict(t, r, &req)
			if req.Target.Kind != "room" || req.Target.ID != "room_2" {
				t.Fatalf("unexpected forward target: %+v", req.Target)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"room_id":"room_2","room_binding_ids":[],"message":{"id":"msg_fwd_99","tenant_id":"ten_1","room_id":"room_2","author":{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"},"message_kind":"conversation","raw_message":"Forwarded","segments":[{"type":"text","content":"Forwarded"}],"attachments":[],"created_at":"` + now + `"}}`))

		// P1-6 #4: POST /v0/tenants/:tenantId/rooms -> HumanRoomCreateRequest (NO member_actor_ids) + PUT /v0/rooms/:id/members/:actorId
		case r.Method == http.MethodPost && r.URL.Path == "/v0/tenants/ten_1/rooms":
			var req struct {
				Name        string  `json:"name"`
				Description *string `json:"description"`
			}
			decodeStrict(t, r, &req)
			if req.Name != "Launch" {
				t.Fatalf("unexpected room name: %q", req.Name)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"room_new","tenant_id":"ten_1","kind":"group","name":"Launch","created_by":{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"},"created_at":"` + now + `","updated_at":"` + now + `"}`))

		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/v0/rooms/room_new/members/"):
			actorID := strings.TrimPrefix(r.URL.Path, "/v0/rooms/room_new/members/")
			var req struct {
				Role string `json:"role"`
			}
			decodeStrict(t, r, &req)
			mu.Lock()
			invitedMembers = append(invitedMembers, actorID)
			mu.Unlock()
			_, _ = w.Write([]byte(`{"room_id":"room_new","actor":{"id":"` + actorID + `","tenant_id":"ten_1","kind":"agent","display_name":"Scout"},"added_by":{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"},"role":"member","joined_at":"` + now + `","updated_at":"` + now + `"}`))

		// P1-6 #5: POST /v0/rooms/:roomId/history-shares/create -> CreateRoomHistoryShare (web_version only) + real RoomHistoryShare response
		case r.Method == http.MethodPost && r.URL.Path == "/v0/rooms/room_1/history-shares/create":
			var req struct {
				WebVersion *string `json:"web_version"`
			}
			decodeStrict(t, r, &req)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"sh_1","room_name":"Product Launch","message_count":12,"snapshot_room_seq":42,"revoked":false,"token":"tok_abc","created_at":"` + now + `"}`))

		// P1-6 #6: GET /v0/tenants/:tenantId/room-activity -> {"running_room_ids":[...],"failed_room_ids":[...]}
		case r.Method == http.MethodGet && r.URL.Path == "/v0/tenants/ten_1/room-activity":
			_, _ = w.Write([]byte(`{"running_room_ids":["room_1"],"failed_room_ids":["room_err"]}`))

		// P1-6 #7: GET /v0/rooms/:roomId/runs/:runId/runtime-presentation-events -> nested {event_ordinal, segment_id, message_id, event: {...}}
		case r.Method == http.MethodGet && r.URL.Path == "/v0/rooms/room_1/runs/run_7/runtime-presentation-events":
			_, _ = w.Write([]byte(`{"published_through_ordinal":2,"has_more":false,"items":[{"event_ordinal":1,"segment_id":"seg_1","event":{"type":"plan_updated","explanation":"Plan checks","steps":[{"content":"Step A","status":"completed"}]}},{"event_ordinal":2,"segment_id":"seg_1","message_id":"msg_99","event":{"type":"presentation_output_created","output_id":"o1","output_kind":"text","text":"Streaming reply"}}]}`))

		// P1-6 #8: GET /v0/rooms/:roomId/pins -> {"items":[{"message":Message,"pinned_at":...,"pinned_by_actor_id":...}]}
		case r.Method == http.MethodGet && r.URL.Path == "/v0/rooms/room_1/pins":
			_, _ = w.Write([]byte(`{"items":[{"pinned_at":"` + now + `","pinned_by_actor_id":"act_1","message":{"id":"msg_pin_1","tenant_id":"ten_1","room_id":"room_1","author":{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"},"message_kind":"conversation","raw_message":"Pinned text","segments":[{"type":"text","content":"Pinned text"}],"attachments":[],"created_at":"` + now + `"}}]}`))

		// P1-6 #9: GET /v0/tenants/:tenantId/another-me -> {"agent_actor_id","room_id"}
		case r.Method == http.MethodGet && r.URL.Path == "/v0/tenants/ten_1/another-me":
			_, _ = w.Write([]byte(`{"agent_actor_id":"act_am","room_id":"room_am"}`))

		// P1-6 #10: GET /v0/tenants/:tenantId/local-computers & .../local-models (exact TeamHub OpenAPI schema)
		case r.Method == http.MethodGet && r.URL.Path == "/v0/tenants/ten_1/local-computers":
			_, _ = w.Write([]byte(`{"items":[{"computer_id":"comp_1","display_name":"Studio Mac","status":"online","active_operations":1,"upgrade_required":false,"runtimes":[{"type":"pi","status":"ready","models":[{"id":"qwen3-4b","label":"Qwen3 4B","is_default":true}]}],"workspace_grants":[]}]}`))

		case r.Method == http.MethodGet && r.URL.Path == "/v0/tenants/ten_1/local-computers/comp_1/local-models":
			_, _ = w.Write([]byte(`{"available":true,"viewer_is_owner":true,"reason":{"code":"NOT_REPORTED","detail":"none"},"computer":{"computer_id":"comp_1","display_name":"Studio Mac","status":"online","host":{"os":"darwin","arch":"arm64"}},"pools":[{"id":"unified","kind":"unified","total_bytes":34359738368,"used_bytes":6442450944,"holders":[]}],"models":[{"model":{"id":"qwen3-4b:Q4_K_M","name":"Qwen3 4B","description":"Fast","quant":"Q4_K_M","fit":"unified","state":"downloading","context_tokens":32768,"download_bytes":2600000000,"memory_bytes":3400000000,"vision":false,"recommended":true,"availability":{"downloadable":false,"reason":{"code":"MEMORY_INSUFFICIENT","have_bytes":1024,"need_bytes":2048}},"download":{"done_bytes":1300000000,"total_bytes":2600000000,"step":"downloading"},"error":{"code":"DOWNLOAD_FAILED","detail":"disk full"}},"used_by":[{"agent_id":"act_agent_1","name":"Scout"}]}]}`))

		// P1-6 #11: POST /v0/tenants/:tenantId/local-computers/:id/model-source -> strict validModelSourceSwitch parity
		case r.Method == http.MethodPost && r.URL.Path == "/v0/tenants/ten_1/local-computers/comp_1/model-source":
			var req struct {
				Mode           string         `json:"mode"`
				Runtime        *string        `json:"runtime"`
				Byok           *api.ByokInput `json:"byok"`
				LocalModelID   *string        `json:"local_model_id"`
				ForceTerminate *bool          `json:"force_terminate"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			if err := dec.Decode(&req); err != nil || !strictValidModelSourceSwitch(req.Mode, req.Runtime, req.Byok, req.LocalModelID) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"code":"INVALID_REQUEST","message":"Model source switch is invalid"}}`))
				return
			}
			rt := "pi"
			if req.Runtime != nil {
				rt = *req.Runtime
			}
			switch req.Mode {
			case "byok":
				_, _ = w.Write([]byte(`{"computer_id":"comp_1","online":true,"viewer_is_owner":true,"status":{"mode":"byok","runtime":"` + rt + `","runtime_model":"` + req.Byok.ModelID + `","byok":{"configured":true,"key_saved":true,"base_url":"https://api.openai.com","path":"/v1","endpoint":"/chat/completions","protocol":"openai-chat","model_id":"` + req.Byok.ModelID + `","context_window":128000}}}`))
			case "subscription":
				_, _ = w.Write([]byte(`{"computer_id":"comp_1","online":true,"viewer_is_owner":true,"status":{"mode":"subscription","runtime":"` + rt + `","runtime_model":"claude-sonnet-4","byok":{"configured":false,"key_saved":false}}}`))
			case "local":
				lm := "localmodels/qwen3-4b:Q4_K_M"
				if req.LocalModelID != nil && *req.LocalModelID != "" {
					lm = *req.LocalModelID
				}
				_, _ = w.Write([]byte(`{"computer_id":"comp_1","online":true,"viewer_is_owner":true,"status":{"mode":"local","runtime":"pi","runtime_model":"` + lm + `","byok":{"configured":false,"key_saved":false}}}`))
			}

		case r.Method == http.MethodPost && r.URL.Path == "/v0/tenants/ten_1/local-computers/comp_1/model-source/test":
			var req struct {
				Byok api.ByokInput `json:"byok"`
			}
			decodeStrict(t, r, &req)
			if !strictValidByokInput(req.Byok) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"code":"INVALID_REQUEST","message":"BYOK configuration is invalid"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"model_id":"` + req.Byok.ModelID + `","protocol":"` + req.Byok.Protocol + `","url":"` + req.Byok.BaseURL + req.Byok.Path + req.Byok.Endpoint + `","context_window":128000}`))

		case r.Method == http.MethodPost && r.URL.Path == "/v0/tenants/ten_1/local-computers/comp_1/model-source/models":
			var req api.ByokEndpointInput
			decodeStrict(t, r, &req)
			if !strictValidByokAddress(req.BaseURL, req.Path, req.Endpoint, req.Protocol) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"code":"INVALID_REQUEST","message":"BYOK endpoint is invalid"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"url":"` + req.BaseURL + req.Path + `/models","models":[{"id":"gpt-4o-mini","name":"GPT-4o Mini"}]}`))

		// P1-6 #12: PUT & DELETE /v0/tenants/:tenantId/agents/:agentId/skill-bindings/:skillId
		case r.Method == http.MethodPut && r.URL.Path == "/v0/tenants/ten_1/agents/act_agent_1/skill-bindings/skill.git":
			var req struct {
				Config                 map[string]any `json:"config"`
				Enabled                bool           `json:"enabled"`
				ExpectedBindingVersion int64          `json:"expected_binding_version"`
				ManifestVersion        string         `json:"manifest_version"`
				ReplaceSkillID         *string        `json:"replace_skill_id"`
			}
			decodeStrict(t, r, &req)
			if req.ExpectedBindingVersion < 1 || req.ManifestVersion != "1.0.0" {
				t.Fatalf("invalid skill binding PUT: %+v", req)
			}
			_, _ = w.Write([]byte(`{"id":"b1","tenant_id":"ten_1","agent_actor_id":"act_agent_1","binding_version":2,"enabled":true,"skill":{"skill_id":"skill.git","manifest_version":"1.0.0"},"updated_at":"` + now + `"}`))

		case r.Method == http.MethodDelete && r.URL.Path == "/v0/tenants/ten_1/agents/act_agent_1/skill-bindings/skill.git":
			mu.Lock()
			deletedSkillQuery = r.URL.Query().Get("expected_binding_version")
			mu.Unlock()
			if deletedSkillQuery != "2" {
				t.Fatalf("expected expected_binding_version=2 on DELETE, got %q", deletedSkillQuery)
			}
			w.WriteHeader(http.StatusNoContent)

		// P1-6 #13a: GET /v0/library/documents requires ?view=...
		case r.Method == http.MethodGet && r.URL.Path == "/v0/library/documents":
			if r.URL.Query().Get("view") != "recent" {
				t.Fatalf("expected ?view=recent on ListLibraryDocuments, got %q", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"doc_1","tenant_id":"ten_1","title":"Spec","format":"markdown","representation_format":"markdown","status":"active","created_at":"` + now + `","updated_at":"` + now + `"}],"page":{"has_more":false}}`))

		// P1-6 #13b: POST /v0/external-connections -> {"app_key"}
		case r.Method == http.MethodPost && r.URL.Path == "/v0/external-connections":
			var req struct {
				AppKey             string  `json:"app_key"`
				DesktopCallbackURL *string `json:"desktop_callback_url"`
			}
			decodeStrict(t, r, &req)
			if req.AppKey != "github" {
				t.Fatalf("expected app_key=github, got %q", req.AppKey)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"conn_1","provider":"github","status":"pending","revision":1,"created_at":"` + now + `","updated_at":"` + now + `"}`))

		// P1-6 #13c: GET /v0/tenants/:tenantId/me/pocket-notes -> {"today", "items":[{"date","text","updated_at"}]}
		case r.Method == http.MethodGet && r.URL.Path == "/v0/tenants/ten_1/me/pocket-notes":
			_, _ = w.Write([]byte(`{"today":"2026-11-24","items":[{"date":"2026-11-24","text":"Ship contract tests","updated_at":"` + now + `"}],"page":{"has_more":false}}`))

		default:
			t.Fatalf("unexpected request: %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
		}
	}))
	defer srv.Close()

	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_test_tok",
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	// 1. Login (P0-4b)
	if _, err := cl.Login(ctx, "alex@linger.dev", "secret-pass"); err != nil {
		t.Fatalf("Login: %v", err)
	}
	// 2. CreateMessage + Reaction decoding (P0-4a + P1-6 #13d)
	msg, err := cl.CreateMessage(ctx, "room_1", api.CreateMessageRequest{
		RawMessage:        "Hello TeamHub",
		ContextMessageIDs: []string{"msg_prev"},
	}, "idem_msg_1")
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if len(msg.Reactions) != 1 || msg.Reactions[0].Count() != 2 || !msg.Reactions[0].ReactedBy("act_1") || msg.Reactions[0].ReactedBy("act_9") {
		t.Fatalf("unexpected decoded MessageReaction: %+v", msg.Reactions)
	}
	// 3. Read state (P1-6 #1)
	if err := cl.UpdateRoomReadState(ctx, "room_1", 42); err != nil {
		t.Fatalf("UpdateRoomReadState: %v", err)
	}
	// 4. Cancel run (P1-6 #2)
	if err := cl.CancelRoomRun(ctx, "room_1", "run_7"); err != nil {
		t.Fatalf("CancelRoomRun: %v", err)
	}
	// 5. Forward message (P1-6 #3)
	fwd, err := cl.ForwardRoomMessage(ctx, "room_1", "msg_99", "room_2", "idem_fwd_1")
	if err != nil || fwd.ID != "msg_fwd_99" {
		t.Fatalf("ForwardRoomMessage: %+v (%v)", fwd, err)
	}
	// 6. CreateRoom + PutRoomMember (P1-6 #4)
	rm, err := cl.CreateRoom(ctx, "ten_1", "Launch", "", []string{"act_agent_1"})
	if err != nil || rm.ID != "room_new" {
		t.Fatalf("CreateRoom: %+v (%v)", rm, err)
	}
	mu.Lock()
	if len(invitedMembers) != 1 || invitedMembers[0] != "act_agent_1" {
		t.Fatalf("expected extra member invited via PUT /members, got %v", invitedMembers)
	}
	mu.Unlock()
	// 7. History share (P1-6 #5)
	sh, err := cl.CreateRoomHistoryShare(ctx, "room_1", "")
	if err != nil || sh.RoomName != "Product Launch" || sh.Token == nil || *sh.Token != "tok_abc" {
		t.Fatalf("CreateRoomHistoryShare: %+v (%v)", sh, err)
	}
	// 8. Room activity (P1-6 #6)
	act, err := cl.GetRoomActivity(ctx, "ten_1")
	if err != nil || len(act.RunningRoomIDs) != 1 || act.RunningRoomIDs[0] != "room_1" || len(act.FailedRoomIDs) != 1 {
		t.Fatalf("GetRoomActivity: %+v (%v)", act, err)
	}
	// 9. Runtime presentation events unwrapping (P1-6 #7)
	page, err := cl.ListRoomRuntimePresentationEvents(ctx, "room_1", "run_7", 0)
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("ListRoomRuntimePresentationEvents: %+v (%v)", page, err)
	}
	var ev1, ev2 api.RuntimePresentationEvent
	_ = json.Unmarshal(page.Items[0], &ev1)
	ev1.Raw = page.Items[0]
	_ = json.Unmarshal(page.Items[1], &ev2)
	ev2.Raw = page.Items[1]
	p1 := api.ParsePresentationEvent(ev1)
	p2 := api.ParsePresentationEvent(ev2)
	if p1.Type != "plan_updated" || len(p1.Steps) != 1 || p1.Steps[0].Content != "Step A" {
		t.Fatalf("expected unwrapped plan_updated event, got %+v", p1)
	}
	if p2.Type != "presentation_output_created" || p2.OutputText != "Streaming reply" {
		t.Fatalf("expected unwrapped presentation_output_created event, got %+v", p2)
	}
	// 10. Message pins unwrapping (P1-6 #8)
	pins, err := cl.ListMessagePins(ctx, "room_1")
	if err != nil || len(pins) != 1 || pins[0].ID != "msg_pin_1" {
		t.Fatalf("ListMessagePins: %+v (%v)", pins, err)
	}
	// 11. Another Me (P1-6 #9)
	am, err := cl.GetAnotherMe(ctx, "ten_1")
	if err != nil || am.RoomID == nil || *am.RoomID != "room_am" || am.AgentActorID == nil || *am.AgentActorID != "act_am" {
		t.Fatalf("GetAnotherMe: %+v (%v)", am, err)
	}
	// 12. Local computers + local models (P1-6 #10)
	comps, err := cl.ListLocalComputers(ctx, "ten_1")
	if err != nil || len(comps) != 1 || len(comps[0].Runtimes) != 1 || len(comps[0].Runtimes[0].Models) != 1 || comps[0].Runtimes[0].Models[0].ID != "qwen3-4b" {
		t.Fatalf("ListLocalComputers: %+v (%v)", comps, err)
	}
	lm, err := cl.GetLocalComputerModels(ctx, "ten_1", "comp_1")
	if err != nil || lm.Computer.Status != "online" || lm.Reason == nil || lm.Reason.Code != "NOT_REPORTED" {
		t.Fatalf("GetLocalComputerModels: %+v (%v)", lm, err)
	}
	if len(lm.Models) != 1 || lm.Models[0].Model.Download == nil || lm.Models[0].Model.Download.DoneBytes != 1300000000 ||
		lm.Models[0].Model.Error == nil || lm.Models[0].Model.Error.Detail == nil || *lm.Models[0].Model.Error.Detail != "disk full" ||
		lm.Models[0].Model.Availability.Reason == nil || lm.Models[0].Model.Availability.Reason.Code != "MEMORY_INSUFFICIENT" ||
		len(lm.Models[0].UsedBy) != 1 || lm.Models[0].UsedBy[0].AgentID != "act_agent_1" {
		t.Fatalf("GetLocalComputerModels nested fields mismatch: %+v", lm.Models)
	}
	// 13. Model source local / subscription / BYOK + ByokSummary + strict rejection checks
	key := "sk-live-secret"
	rtPi := "pi"
	rtClaude := "claude"
	localModelID := "qwen3-4b:Q4_K_M"
	msLocal, err := cl.SwitchLocalComputerModelSource(ctx, "ten_1", "comp_1", api.ModelSourceSwitchRequest{
		Mode:         "local",
		Runtime:      &rtPi,
		LocalModelID: &localModelID,
	})
	if err != nil || msLocal.Status == nil || msLocal.Status.Mode != "local" {
		t.Fatalf("SwitchLocalComputerModelSource (local): %+v (%v)", msLocal, err)
	}
	msSub, err := cl.SwitchLocalComputerModelSource(ctx, "ten_1", "comp_1", api.ModelSourceSwitchRequest{
		Mode:    "subscription",
		Runtime: &rtClaude,
	})
	if err != nil || msSub.Status == nil || msSub.Status.Mode != "subscription" || msSub.Status.Runtime != "claude" {
		t.Fatalf("SwitchLocalComputerModelSource (subscription): %+v (%v)", msSub, err)
	}
	byokCfg := api.ByokInput{
		BaseURL:  "https://api.openai.com",
		Path:     "/v1",
		Endpoint: "/chat/completions",
		Protocol: "openai-chat",
		ModelID:  "gpt-4o-mini",
		APIKey:   &key,
	}
	ms, err := cl.SwitchLocalComputerModelSource(ctx, "ten_1", "comp_1", api.ModelSourceSwitchRequest{
		Mode:    "byok",
		Runtime: &rtPi,
		Byok:    &byokCfg,
	})
	if err != nil || ms.Status == nil || ms.Status.Mode != "byok" || !ms.Status.Byok.Configured || !ms.Status.Byok.KeySaved ||
		ms.Status.Byok.ModelID == nil || *ms.Status.Byok.ModelID != "gpt-4o-mini" ||
		ms.Status.Byok.BaseURL == nil || *ms.Status.Byok.BaseURL != "https://api.openai.com" ||
		ms.Status.Byok.Path == nil || *ms.Status.Byok.Path != "/v1" ||
		ms.Status.Byok.Endpoint == nil || *ms.Status.Byok.Endpoint != "/chat/completions" ||
		ms.Status.Byok.Protocol == nil || *ms.Status.Byok.Protocol != "openai-chat" ||
		ms.Status.Byok.ContextWindow == nil || *ms.Status.Byok.ContextWindow != 128000 {
		t.Fatalf("SwitchLocalComputerModelSource (byok): %+v (%v)", ms, err)
	}
	if testRes, err := cl.TestLocalComputerModelSourceTyped(ctx, "ten_1", "comp_1", byokCfg); err != nil || !testRes.Ok {
		t.Fatalf("TestLocalComputerModelSourceTyped: %+v (%v)", testRes, err)
	}
	if modelsRes, err := cl.ListLocalComputerByokModelsTyped(ctx, "ten_1", "comp_1", byokCfg); err != nil || len(modelsRes.Models) != 1 {
		t.Fatalf("ListLocalComputerByokModelsTyped: %+v (%v)", modelsRes, err)
	}
	for _, invalid := range []struct {
		name string
		req  api.ModelSourceSwitchRequest
	}{
		{"managed mode", api.ModelSourceSwitchRequest{Mode: "managed"}},
		{"byok missing runtime", api.ModelSourceSwitchRequest{Mode: "byok", Byok: &byokCfg}},
		{"subscription on pi", api.ModelSourceSwitchRequest{Mode: "subscription", Runtime: &rtPi}},
		{"byok legacy protocol", api.ModelSourceSwitchRequest{Mode: "byok", Runtime: &rtPi, Byok: &api.ByokInput{
			BaseURL: "https://api.openai.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai_chat_completions", ModelID: "gpt-4o-mini",
		}}},
	} {
		if _, err := cl.SwitchLocalComputerModelSource(ctx, "ten_1", "comp_1", invalid.req); err == nil {
			t.Fatalf("expected HTTP 400 rejection for %s", invalid.name)
		}
	}
	// 14. Agent skill binding PUT & DELETE (P1-6 #12)
	b, err := cl.PutAgentSkillBinding(ctx, "ten_1", "act_agent_1", "skill.git", api.AgentSkillBindingPutRequest{
		Config:                 map[string]any{},
		Enabled:                true,
		ExpectedBindingVersion: 1,
		ManifestVersion:        "1.0.0",
	})
	if err != nil || b.BindingVersion != 2 {
		t.Fatalf("PutAgentSkillBinding: %+v (%v)", b, err)
	}
	if err := cl.DeleteAgentSkillBinding(ctx, "ten_1", "act_agent_1", "skill.git", 2); err != nil {
		t.Fatalf("DeleteAgentSkillBinding: %v", err)
	}
	// 15. Library documents view, External connection app_key, Pocket notes date/text (P1-6 #13)
	docs, err := cl.ListLibraryDocuments(ctx, 20, "")
	if err != nil || len(docs.Items) != 1 {
		t.Fatalf("ListLibraryDocuments: %+v (%v)", docs, err)
	}
	conn, err := cl.CreateExternalConnection(ctx, "github")
	if err != nil || conn.Provider != "github" {
		t.Fatalf("CreateExternalConnection: %+v (%v)", conn, err)
	}
	pnotes, err := cl.ListPocketNotes(ctx, "ten_1", 7, "")
	if err != nil || len(pnotes.Items) != 1 || pnotes.Items[0].NoteDate != "2026-11-24" || pnotes.Items[0].Body != "Ship contract tests" {
		t.Fatalf("ListPocketNotes: %+v (%v)", pnotes, err)
	}
}

// TestAuthenticatedHTTPClientOriginGuardAndRedirectDefense proves P0-2:
// 1. Credentials are attached ONLY on same-origin requests, never cross-origin.
// 2. HTTPS->HTTP downgrade redirects and cross-origin redirects are blocked across
//    Client API requests, AuthenticatedHTTPClient, and ProbeCompanionTOFU.
func TestAuthenticatedHTTPClientOriginGuardAndRedirectDefense(t *testing.T) {
	var thirdPartyAuth, thirdPartyCookie string
	var thirdPartyHits int
	thirdParty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		thirdPartyHits++
		thirdPartyAuth = r.Header.Get("Authorization")
		thirdPartyCookie = r.Header.Get("Cookie")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer thirdParty.Close()

	var sameOriginAuth string
	originSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/img.png" {
			sameOriginAuth = r.Header.Get("Authorization")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/redirect-cross" || r.URL.Path == "/v0/me" || r.URL.Path == "/companion/v1/info" {
			http.Redirect(w, r, thirdParty.URL+"/steal", http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer originSrv.Close()

	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        originSrv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_secret_token_999",
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	authHTTP := cl.AuthenticatedHTTPClient()

	// Same-origin request receives Bearer token.
	resp, err := authHTTP.Get(originSrv.URL + "/img.png")
	if err != nil {
		t.Fatalf("same-origin GET: %v", err)
	}
	_ = resp.Body.Close()
	if sameOriginAuth != "Bearer lmc_secret_token_999" {
		t.Fatalf("expected same-origin Authorization header, got %q", sameOriginAuth)
	}

	// Cross-origin request must NOT receive Authorization or Cookie.
	req, _ := http.NewRequest(http.MethodGet, thirdParty.URL+"/avatar.png", nil)
	req.Header.Set("Authorization", "Bearer pre-populated")
	req.Header.Set("Cookie", "teamhub_session=pre-populated")
	resp2, err := authHTTP.Do(req)
	if err != nil {
		t.Fatalf("cross-origin GET: %v", err)
	}
	_ = resp2.Body.Close()
	if thirdPartyAuth != "" || thirdPartyCookie != "" {
		t.Fatalf("cross-origin credential leak! auth=%q cookie=%q", thirdPartyAuth, thirdPartyCookie)
	}

	// Cross-origin redirect on AuthenticatedHTTPClient must be blocked.
	hitsBefore := thirdPartyHits
	if _, err := authHTTP.Get(originSrv.URL + "/redirect-cross"); err == nil {
		t.Fatal("expected cross-origin redirect on AuthenticatedHTTPClient to fail")
	}
	if thirdPartyHits != hitsBefore {
		t.Fatalf("redirect target should not have been contacted, hits increased from %d to %d", hitsBefore, thirdPartyHits)
	}

	// Redirect on API GetMe must NOT be followed (http.ErrUseLastResponse -> 302 API error).
	if _, err := cl.GetMe(context.Background()); err == nil {
		t.Fatal("expected 302 redirect on GetMe to fail without following")
	}
	if thirdPartyHits != hitsBefore {
		t.Fatal("GetMe followed redirect to third-party host")
	}

	// HTTPS -> HTTP downgrade redirect on TLS-pinned server + ProbeCompanionTOFU must be blocked.
	cert, fp := newTestSelfSignedTLS(t)
	tlsSrv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, thirdParty.URL+"/downgrade", http.StatusFound)
	}))
	tlsSrv.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{cert}}
	tlsSrv.StartTLS()
	defer tlsSrv.Close()

	pinnedCl, err := api.NewClient(api.ClientConfig{
		BaseURL:        tlsSrv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_pinned_secret",
		TLSFingerprint: fp,
		AllowPlainHTTP: false,
	})
	if err != nil {
		t.Fatalf("pinned NewClient: %v", err)
	}
	if _, err := pinnedCl.AuthenticatedHTTPClient().Get(tlsSrv.URL + "/img"); err == nil {
		t.Fatal("expected HTTPS->HTTP downgrade redirect to be blocked")
	}
	if _, err := api.ProbeCompanionTOFU(context.Background(), tlsSrv.URL, false); err == nil {
		t.Fatal("expected ProbeCompanionTOFU to refuse 302 redirect")
	}
	if thirdPartyHits != hitsBefore {
		t.Fatal("HTTPS->HTTP downgrade redirect leaked a request to plain HTTP target")
	}
}

func newTestSelfSignedTLS(t *testing.T) (tls.Certificate, string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "Linger Contract Test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}
	fp := discovery.ComputeSPKIFingerprint(leaf.RawSubjectPublicKeyInfo)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: priv, Leaf: leaf}, fp
}

var (
	contractByokPathPattern    = regexp.MustCompile(`^(/[^/?#\s\\]+)*$`)
	contractLocalModelPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`)
)

func strictValidByokAddress(baseURL, path, endpoint, protocol string) bool {
	validProto := protocol == "anthropic" || protocol == "openai-chat" || protocol == "openai-responses"
	return strings.TrimSpace(baseURL) != "" && len(baseURL) <= 2048 && validProto &&
		len(path) <= 256 && contractByokPathPattern.MatchString(path) &&
		len(endpoint) <= 256 && contractByokPathPattern.MatchString(endpoint)
}

func strictValidByokInput(in api.ByokInput) bool {
	return strictValidByokAddress(in.BaseURL, in.Path, in.Endpoint, in.Protocol) &&
		strings.TrimSpace(in.ModelID) != "" && len(in.ModelID) <= 256 &&
		(in.APIKey == nil || len(*in.APIKey) <= 4096) &&
		(in.ContextWindow == nil || *in.ContextWindow >= 1)
}

func strictValidModelSourceSwitch(mode string, runtime *string, byok *api.ByokInput, localModelID *string) bool {
	if runtime != nil && *runtime != "claude" && *runtime != "codex" && *runtime != "pi" {
		return false
	}
	switch mode {
	case "byok":
		return runtime != nil && localModelID == nil && byok != nil && strictValidByokInput(*byok)
	case "subscription":
		return runtime != nil && *runtime != "pi" && localModelID == nil && byok == nil
	case "local":
		return (runtime == nil || *runtime == "pi") && byok == nil &&
			(localModelID == nil || contractLocalModelPattern.MatchString(*localModelID))
	}
	return false
}
