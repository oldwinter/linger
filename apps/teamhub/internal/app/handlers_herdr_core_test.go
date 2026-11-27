package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
	api "github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
	agentapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
	"github.com/simplexai-labs/linger/contracts-go/teamhubinternal"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func TestSignHerdrCoreAttachTokenMatchesNodeServicesFormat(t *testing.T) {
	claims := HerdrCoreAttachTokenClaims{
		V:            1,
		SessionID:    "hcs_123",
		ComputerID:   "comp-1",
		TenantID:     "tenant-1",
		OwnerActorID: "actor-1",
		Address:      "vps/t7",
		Cols:         120,
		Rows:         36,
		Observe:      true,
		History:      200,
		Resumed:      true,
		Exp:          1732670460,
	}
	token, err := SignHerdrCoreAttachToken(claims, "shared-secret")
	if err != nil {
		t.Fatal(err)
	}
	payload, sig, ok := strings.Cut(token, ".")
	if !ok || payload == "" || sig == "" {
		t.Fatalf("unexpected token format: %q", token)
	}
	mac := hmac.New(sha256.New, []byte("shared-secret"))
	mac.Write([]byte("herdr-core-attach-v1\n" + payload))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if sig != wantSig {
		t.Fatalf("signature mismatch: got %q want %q", sig, wantSig)
	}
	decodedBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		t.Fatal(err)
	}
	var decoded HerdrCoreAttachTokenClaims
	if err := json.Unmarshal(decodedBytes, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded != claims {
		t.Fatalf("decoded=%+v want=%+v", decoded, claims)
	}
}

func TestHerdrCoreQuestionSupportsKeysAndTextOptions(t *testing.T) {
	keys := []string{"y", "Enter"}
	q, optionKeys, ok := herdrCoreQuestion(agentapi.AgentHerdrCoreAskRequest{
		Address:  "vps/t7",
		Turn:     4,
		StatusMs: 1732670400000,
		Question: "Approve deploy?",
		Options: []agentapi.HerdrCoreAskOption{
			{Label: "Approve", Keys: &keys},
			{Label: "Abort"},
		},
	})
	if !ok {
		t.Fatal("expected valid question")
	}
	if len(q.Questions) != 1 || len(q.Questions[0].Options) != 2 {
		t.Fatalf("questions=%+v", q.Questions)
	}
	if !slices.Equal(optionKeys["choice_1"], []string{"y", "Enter"}) {
		t.Fatalf("optionKeys=%+v", optionKeys)
	}
	if _, has := optionKeys["choice_2"]; has {
		t.Fatalf("choice_2 should not have optionKeys: %+v", optionKeys)
	}

	badKeys := []string{"y\n"}
	if _, _, ok := herdrCoreQuestion(agentapi.AgentHerdrCoreAskRequest{
		Address:  "t7",
		Turn:     1,
		StatusMs: 1,
		Question: "Bad?",
		Options:  []agentapi.HerdrCoreAskOption{{Label: "Bad", Keys: &badKeys}},
	}); ok {
		t.Fatal("expected control character key to be rejected")
	}
}

func TestFilterHerdrCoreTerminalsResult(t *testing.T) {
	raw := map[string]any{
		"terminals": []any{
			map[string]any{
				"address": "t1",
				"machine": "",
				"state":   "live",
				"status":  map[string]any{"state": "blocked"},
				"labels":  map[string]any{proactive.HerdrCoreLabelRoom: "room-1", proactive.HerdrCoreLabelWorkItem: "wi-1"},
			},
			map[string]any{
				"address": "vps/t2",
				"machine": "vps",
				"state":   "live",
				"status":  map[string]any{"state": "working"},
				"labels":  map[string]any{proactive.HerdrCoreLabelRoom: "room-2"},
			},
		},
		"machines": []any{},
	}
	machine := "vps"
	roomID := "room-2"
	status := "working"
	filtered := filterHerdrCoreTerminalsResult(raw, httpapi.ListHerdrCoreTerminalsParams{
		Machine: &machine,
		RoomId:  &roomID,
		Status:  &status,
	})
	terminals := filtered["terminals"].([]any)
	if len(terminals) != 1 || terminals[0].(map[string]any)["address"] != "vps/t2" {
		t.Fatalf("filtered terminals=%+v", terminals)
	}
}

func TestHerdrCoreOpCacheIdempotencyAndConflict(t *testing.T) {
	cache := newHerdrCoreOpCache()
	now := time.Now()
	hashA := sha256.Sum256([]byte("req-a"))
	hashB := sha256.Sum256([]byte("req-b"))
	want := agentapi.AgentHerdrCoreCallResponse{
		ComputerId: "comp-1",
		ToolName:   agentapi.HerdrCoreToolNameRun,
		Result:     map[string]any{"address": "t9"},
	}
	cache.store("agent-1:op-1", hashA, want, now)

	got, found, conflict := cache.lookup("agent-1:op-1", hashA, now.Add(time.Second))
	if !found || conflict || got.ComputerId != "comp-1" || got.Result["address"] != "t9" {
		t.Fatalf("replay failed: got=%+v found=%v conflict=%v", got, found, conflict)
	}
	if _, found, conflict := cache.lookup("agent-1:op-1", hashB, now.Add(time.Second)); !found || !conflict {
		t.Fatalf("expected conflict on mismatched payload: found=%v conflict=%v", found, conflict)
	}
}

type fakeHerdrCoreTools struct {
	roomagent.LocalComputerManagement
	last api.LocalComputerToolCall
	err  error
}

func (f *fakeHerdrCoreTools) CallLocalComputerTool(_ context.Context, call api.LocalComputerToolCall) (map[string]any, error) {
	f.last = call
	if f.err != nil {
		return nil, f.err
	}
	return map[string]any{"status": "ok"}, nil
}

func TestDeliverHerdrCoreAnswerDispatchesKeysOrText(t *testing.T) {
	fake := &fakeHerdrCoreTools{}
	application := &App{localComputers: fake}

	status := application.deliverHerdrCoreAnswer(t.Context(), typedcard.HerdrCoreDelivery{
		TenantID:          "tenant-1",
		OwnerActorID:      "actor-1",
		AgentManagementID: "agent-1",
		Target: typedcard.HerdrCoreAnswerTarget{
			ComputerID: "comp-1",
			Address:    "vps/t7",
			Turn:       4,
			StatusMs:   1000,
		},
		Keys: []string{"y", "Enter"},
	})
	if status != typedcard.HerdrCoreAnswerSent {
		t.Fatalf("status=%q", status)
	}
	if fake.last.Server != api.HerdrCore || fake.last.ToolName != "answer" ||
		fake.last.Arguments["address"] != "vps/t7" ||
		!slices.Equal(fake.last.Arguments["keys"].([]string), []string{"y", "Enter"}) {
		t.Fatalf("unexpected call=%+v", fake.last)
	}

	fake.err = &roomagent.LocalComputerToolError{Code: "terminal_not_blocked", Message: "moved on"}
	status = application.deliverHerdrCoreAnswer(t.Context(), typedcard.HerdrCoreDelivery{
		TenantID:          "tenant-1",
		OwnerActorID:      "actor-1",
		AgentManagementID: "agent-1",
		Target:            typedcard.HerdrCoreAnswerTarget{ComputerID: "comp-1", Address: "t7", Turn: 4, StatusMs: 1000},
		Text:              "continue",
	})
	if status != typedcard.HerdrCoreAnswerNotBlocked || fake.last.Arguments["text"] != "continue" {
		t.Fatalf("status=%q call=%+v", status, fake.last)
	}
}

func TestBuildHerdrCoreSendArgsAcceptsBlockedAndRejectsUnknownIf(t *testing.T) {
	blocked := httpapi.HerdrCoreTerminalSendRequestIfBlocked
	turn := int64(7)
	args, deadlineMs, reason := buildHerdrCoreSendArgs(httpapi.HerdrCoreTerminalSendRequest{
		Address: "vps/t7",
		Text:    "yes",
		If:      &blocked,
		Turn:    &turn,
	})
	if reason != "" || deadlineMs != 0 {
		t.Fatalf("unexpected error=%q deadlineMs=%d", reason, deadlineMs)
	}
	if args["if"] != "blocked" || args["turn"] != int64(7) {
		t.Fatalf("args=%+v", args)
	}

	for _, state := range []httpapi.HerdrCoreTerminalSendRequestIf{
		httpapi.HerdrCoreTerminalSendRequestIfIdle,
		httpapi.HerdrCoreTerminalSendRequestIfWorking,
		httpapi.HerdrCoreTerminalSendRequestIfBlocked,
	} {
		s := state
		if _, _, reason := buildHerdrCoreSendArgs(httpapi.HerdrCoreTerminalSendRequest{
			Address: "t7",
			Text:    "ok",
			If:      &s,
		}); reason != "" {
			t.Fatalf("expected %q to be accepted, got %q", state, reason)
		}
	}

	invalid := httpapi.HerdrCoreTerminalSendRequestIf("done")
	if _, _, reason := buildHerdrCoreSendArgs(httpapi.HerdrCoreTerminalSendRequest{
		Address: "t7",
		Text:    "ok",
		If:      &invalid,
	}); reason == "" {
		t.Fatal("expected unknown if state to be rejected")
	}
}

func TestProxyWebSocketsForwardsBinaryAndTextFrames(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = conn.Close() }()
		for {
			msgType, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := conn.WriteMessage(msgType, payload); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upConn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(upstream.URL, "http"), nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = upConn.Close() }()
		clientConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = clientConn.Close() }()
		proxyWebSockets(r.Context(), clientConn, upConn)
	}))
	defer proxy.Close()

	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(proxy.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()

	if err := client.WriteMessage(websocket.BinaryMessage, []byte{0x1b, '[', '3', '2', 'm'}); err != nil {
		t.Fatal(err)
	}
	msgType, data, err := client.ReadMessage()
	if err != nil || msgType != websocket.BinaryMessage || string(data) != "\x1b[32m" {
		t.Fatalf("binary echo failed: type=%d data=%q err=%v", msgType, data, err)
	}

	if err := client.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatal(err)
	}
	msgType, data, err = client.ReadMessage()
	if err != nil || msgType != websocket.TextMessage || string(data) != `{"type":"ping"}` {
		t.Fatalf("text echo failed: type=%d data=%q err=%v", msgType, data, err)
	}
}

func TestClassifyHerdrCoreResultPreservesOSCStatusAndFlagsErrors(t *testing.T) {
	for _, okResult := range []map[string]any{
		{"status": "ok", "turn": 1, "started": true},
		{"status": "working", "turn": 2, "started": true},
		{"status": "idle", "turn": 2, "started": false},
		{"status": "error", "turn": 3, "started": false},
		{"terminals": []any{}},
	} {
		if err := roomagent.ClassifyHerdrCoreResult(okResult); err != nil {
			t.Fatalf("expected non-error for %+v, got %v", okResult, err)
		}
	}
	var toolErr *roomagent.LocalComputerToolError
	if err := roomagent.ClassifyHerdrCoreResult(map[string]any{"status": "herdr_core_unavailable", "detail": "not installed"}); !errors.As(err, &toolErr) || toolErr.Code != "herdr_core_unavailable" {
		t.Fatalf("herdr_core_unavailable => %v", err)
	}
	if err := roomagent.ClassifyHerdrCoreResult(map[string]any{"status": "error", "detail": "boom"}); !errors.As(err, &toolErr) || toolErr.Code != "error" {
		t.Fatalf("error without turn => %v", err)
	}
	if err := roomagent.ClassifyHerdrCoreResult(map[string]any{"status": "outcome_unknown"}); !errors.Is(err, roomagent.ErrHerdrCoreTimeout) {
		t.Fatalf("outcome_unknown => %v", err)
	}
}

func TestHerdrCoreReportFromRequestPreservesStatusKindAndMsg(t *testing.T) {
	raw := `{
		"computer_id": "comp-1",
		"kind": "agent_blocked",
		"address": "vps/t7",
		"machine": "vps",
		"turn": 4,
		"status_ms": 1732670400000,
		"status": {
			"state": "blocked",
			"kind": "permission",
			"app": "codex",
			"msg": "Allow running deploy script?"
		},
		"tail": "Allow running deploy script? [y/N]"
	}`
	var req teamhubinternal.HerdrCoreEventReport
	if err := decodeStrictJSON(strings.NewReader(raw), &req, "invalid"); err != nil {
		t.Fatalf("decodeStrictJSON: %v", err)
	}
	report := herdrCoreReportFromRequest(req)
	if report.Status == nil || report.Status.State != "blocked" || report.Status.Kind != "permission" ||
		report.Status.App != "codex" || report.Status.Msg != "Allow running deploy script?" ||
		report.Tail != "Allow running deploy script? [y/N]" {
		t.Fatalf("report=%+v status=%+v", report, report.Status)
	}

	rawFallback := `{
		"computer_id": "comp-1",
		"kind": "agent_blocked",
		"address": "t8",
		"turn": 1,
		"status_ms": 1732670400001,
		"status": {"state": "blocked"},
		"tail": "Proceed? [y/N]"
	}`
	var fallbackReq teamhubinternal.HerdrCoreEventReport
	if err := decodeStrictJSON(strings.NewReader(rawFallback), &fallbackReq, "invalid"); err != nil {
		t.Fatalf("decodeStrictJSON(fallback): %v", err)
	}
	fallbackReport := herdrCoreReportFromRequest(fallbackReq)
	if fallbackReport.Status == nil || fallbackReport.Status.Kind != "" || fallbackReport.Status.Msg != "" || fallbackReport.Tail != "Proceed? [y/N]" {
		t.Fatalf("fallbackReport=%+v status=%+v", fallbackReport, fallbackReport.Status)
	}
}
