package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

func TestVoiceMediaSessionAndCredentialWireContractsStrict(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	nowRFC := now.Format(time.RFC3339)
	expRFC := now.Add(10 * time.Minute).Format(time.RFC3339)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v0/rooms/room_1/voice-sessions":
			var req struct {
				Purpose string `json:"purpose"`
			}
			decodeStrict(t, r, &req)
			if req.Purpose != api.VoicePurposeChatLive {
				t.Fatalf("purpose = %q, want %q", req.Purpose, api.VoicePurposeChatLive)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"vs_99","tenant_id":"ten_1","room_id":"room_1","created_by_actor_id":"act_1","status":"connected","purpose":"chat_live","credential_generation":1,"input_ready_generation":0,"created_at":"` + nowRFC + `","updated_at":"` + nowRFC + `"}`))

		case r.Method == http.MethodPost && r.URL.Path == "/v0/voice-sessions/vs_99/connection-credentials":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"endpoint":"wss://lk.example.test","credential":"lk_jwt_token_1","expires_at":"` + expRFC + `","generation":1}`))

		case r.Method == http.MethodGet && r.URL.Path == "/v0/voice-sessions/vs_99":
			_, _ = w.Write([]byte(`{"id":"vs_99","tenant_id":"ten_1","room_id":"room_1","created_by_actor_id":"act_1","status":"connected","purpose":"chat_live","credential_generation":1,"input_ready_generation":1,"input_started_offset_ms":120,"created_at":"` + nowRFC + `","updated_at":"` + nowRFC + `"}`))

		case r.Method == http.MethodPost && r.URL.Path == "/v0/voice-sessions/vs_99/dictation-commit":
			var req struct {
				RequestID string `json:"request_id"`
			}
			decodeStrict(t, r, &req)
			if req.RequestID != "req_commit_1" {
				t.Fatalf("request_id = %q", req.RequestID)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"request_id":"req_commit_1","status":"accepted"}`))

		case r.Method == http.MethodPost && r.URL.Path == "/v0/voice-sessions/vs_99/captures":
			var req struct {
				RoomID        string `json:"room_id"`
				StartOffsetMs int64  `json:"start_offset_ms"`
			}
			decodeStrict(t, r, &req)
			if req.RoomID != "room_1" || req.StartOffsetMs != 250 {
				t.Fatalf("unexpected start capture payload: %+v", req)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"vc_99","voice_session_id":"vs_99","room_id":"room_1","status":"starting","requested_start_offset_ms":250,"gap_count":0,"gap_duration_ms":0,"created_at":"` + nowRFC + `","updated_at":"` + nowRFC + `"}`))

		case r.Method == http.MethodDelete && r.URL.Path == "/v0/voice-sessions/vs_99":
			_, _ = w.Write([]byte(`{"id":"vs_99","tenant_id":"ten_1","room_id":"room_1","created_by_actor_id":"act_1","status":"closed","purpose":"chat_live","credential_generation":1,"input_ready_generation":1,"created_at":"` + nowRFC + `","updated_at":"` + nowRFC + `","closed_at":"` + nowRFC + `"}`))

		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_voice_test",
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	sess, err := cl.CreateVoiceSession(ctx, "room_1", api.VoicePurposeChatLive)
	if err != nil {
		t.Fatalf("CreateVoiceSession: %v", err)
	}
	if sess.ID != "vs_99" || sess.Purpose != api.VoicePurposeChatLive || sess.CredentialGeneration != 1 {
		t.Fatalf("unexpected created session: %+v", sess)
	}

	cred, err := cl.CreateVoiceSessionCredential(ctx, sess.ID)
	if err != nil {
		t.Fatalf("CreateVoiceSessionCredential: %v", err)
	}
	if cred.Endpoint != "wss://lk.example.test" || cred.Credential != "lk_jwt_token_1" || cred.Generation != 1 {
		t.Fatalf("unexpected credential: %+v", cred)
	}

	got, err := cl.GetVoiceSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("GetVoiceSession: %v", err)
	}
	if got.InputReadyGeneration != 1 || got.InputStartedOffsetMs == nil || *got.InputStartedOffsetMs != 120 {
		t.Fatalf("unexpected refreshed session: %+v", got)
	}

	receipt, err := cl.CommitVoiceDictationTurn(ctx, sess.ID, "req_commit_1")
	if err != nil || receipt.Status != "accepted" || receipt.RequestID != "req_commit_1" {
		t.Fatalf("CommitVoiceDictationTurn: %+v (%v)", receipt, err)
	}

	capObj, err := cl.StartVoiceCapture(ctx, sess.ID, "room_1", 250)
	if err != nil || capObj.ID != "vc_99" || capObj.RequestedStartOffsetMs != 250 {
		t.Fatalf("StartVoiceCapture: %+v (%v)", capObj, err)
	}

	closed, err := cl.CloseVoiceSession(ctx, sess.ID)
	if err != nil || closed.Status != "closed" || closed.ClosedAt == nil {
		t.Fatalf("CloseVoiceSession: %+v (%v)", closed, err)
	}
}
