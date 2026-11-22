package native

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/permission"
)

func TestBridgeStopHookAllowBlockCapAndFailOpen(t *testing.T) {
	bridge, requests := claudeReviewBridge()
	hook := NewBridgeStopHook(bridge, "codex", nil)

	// Block once, verify payload fields and attempt progression.
	done := make(chan StopHookDecision, 1)
	go func() {
		done <- hook(context.Background(), StopHookRequest{Runtime: "codex", StopHookActive: false})
	}()
	req := <-requests
	if req.Input["kind"] != "runtime_hook" || req.Input["hook"] != "stop" ||
		req.Input["runtime"] != "codex" || req.Input["attempt"] != 0 || req.Input["stop_hook_active"] != false {
		t.Fatalf("unexpected request payload: %+v", req.Input)
	}
	if err := bridge.Respond(req.InvocationID, json.RawMessage(`{"action":"block","reason":"send reply"}`)); err != nil {
		t.Fatal(err)
	}
	decision := <-done
	if decision.Action != "block" || decision.Reason != "send reply" {
		t.Fatalf("decision = %+v", decision)
	}

	// Next call reports attempt=1 and handles allow.
	go func() {
		done <- hook(context.Background(), StopHookRequest{Runtime: "codex", StopHookActive: true})
	}()
	req = <-requests
	if req.Input["attempt"] != 1 || req.Input["stop_hook_active"] != true {
		t.Fatalf("second request payload = %+v", req.Input)
	}
	_ = bridge.Respond(req.InvocationID, json.RawMessage(`{"action":"allow"}`))
	if got := <-done; got.Action != "allow" {
		t.Fatalf("allow decision = %+v", got)
	}

	// Malformed response fails open as allow.
	go func() {
		done <- hook(context.Background(), StopHookRequest{Runtime: "codex"})
	}()
	req = <-requests
	_ = bridge.Respond(req.InvocationID, json.RawMessage(`not-json`))
	if got := <-done; got.Action != "allow" {
		t.Fatalf("malformed decision = %+v", got)
	}

	// Hitting maxStopHookBlocks stops calling the bridge completely.
	for range maxStopHookBlocks - 1 {
		go func() {
			done <- hook(context.Background(), StopHookRequest{Runtime: "codex"})
		}()
		req = <-requests
		_ = bridge.Respond(req.InvocationID, json.RawMessage(`{"action":"block","reason":"again"}`))
		if got := <-done; got.Action != "block" {
			t.Fatalf("expected block before cap, got %+v", got)
		}
	}
	if got := hook(context.Background(), StopHookRequest{Runtime: "codex"}); got.Action != "allow" || len(requests) != 0 {
		t.Fatalf("expected cap to allow without bridge request, got %+v pending=%d", got, len(requests))
	}
}

func TestClaudeStopHookFlowAndCancel(t *testing.T) {
	// Initialize frame always declares Stop hook so resident shape is stable.
	initRaw := claudeInitializeFrame(RunSpec{ClaudePolicy: &ClaudeToolPolicy{}})
	if !strings.Contains(string(initRaw), `"Stop"`) || !strings.Contains(string(initRaw), claudeStopHookID) {
		t.Fatalf("initialize frame missing Stop hook: %s", initRaw)
	}

	// Without a StopHook handler, Stop callback replies {} inline.
	turnNoHook, wireNoHook := claudeHarness(t, RunSpec{})
	claudeFeed(turnNoHook, `{"type":"control_request","request_id":"s0","request":{"subtype":"hook_callback","callback_id":"hook_stop","input":{"hook_event_name":"Stop","stop_hook_active":false}}}`)
	if line := wireNoHook.await(t, 1)[0]; !strings.Contains(line, `"request_id":"s0"`) || strings.Contains(line, `"block"`) {
		t.Fatalf("inline allow = %s", line)
	}

	// With a StopHook handler: block, allow, cancel, and apiError bypass.
	var mu sync.Mutex
	var calls []StopHookRequest
	cancelStarted := make(chan struct{})
	cancelReleased := make(chan struct{})
	turn, wire := claudeHarness(t, RunSpec{
		StopHook: func(ctx context.Context, req StopHookRequest) StopHookDecision {
			mu.Lock()
			calls = append(calls, req)
			n := len(calls)
			mu.Unlock()
			switch n {
			case 1:
				return StopHookDecision{Action: "block", Reason: "Send your Room reply."}
			case 2:
				return StopHookDecision{Action: "allow"}
			default:
				close(cancelStarted)
				<-ctx.Done()
				close(cancelReleased)
				return StopHookDecision{Action: "allow"}
			}
		},
	})

	claudeFeed(turn, `{"type":"control_request","request_id":"s1","request":{"subtype":"hook_callback","callback_id":"hook_stop","input":{"hook_event_name":"Stop","stop_hook_active":false}}}`)
	line1 := wire.await(t, 1)[0]
	if !strings.Contains(line1, `"request_id":"s1"`) || !strings.Contains(line1, `"decision":"block"`) || !strings.Contains(line1, `"Send your Room reply."`) {
		t.Fatalf("block reply = %s", line1)
	}

	claudeFeed(turn, `{"type":"control_request","request_id":"s2","request":{"subtype":"hook_callback","callback_id":"hook_stop","input":{"hook_event_name":"Stop","stop_hook_active":true}}}`)
	line2 := wire.await(t, 2)[1]
	if !strings.Contains(line2, `"request_id":"s2"`) || strings.Contains(line2, `"block"`) {
		t.Fatalf("allow reply = %s", line2)
	}

	// control_cancel_request cancels an in-flight Stop hook without failing the turn.
	claudeFeed(turn, `{"type":"control_request","request_id":"s3","request":{"subtype":"hook_callback","callback_id":"hook_stop","input":{"hook_event_name":"Stop","stop_hook_active":false}}}`)
	<-cancelStarted
	claudeFeed(turn, `{"type":"control_cancel_request","request_id":"s3"}`)
	select {
	case <-cancelReleased:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop hook was not canceled by control_cancel_request")
	}

	// Turn with an API error bypasses StopHook and replies {} inline.
	turn.apiError = "rate_limit"
	claudeFeed(turn, `{"type":"control_request","request_id":"s4","request":{"subtype":"hook_callback","callback_id":"hook_stop","input":{"hook_event_name":"Stop","stop_hook_active":false}}}`)
	line4 := wire.await(t, 3)[2]
	if !strings.Contains(line4, `"request_id":"s4"`) || strings.Contains(line4, `"block"`) {
		t.Fatalf("apiError bypass reply = %s", line4)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 3 || calls[0].Runtime != "claude" || calls[0].StopHookActive || !calls[1].StopHookActive {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestPiStopHookContinuesInSameProcess(t *testing.T) {
	commandsLog := filepath.Join(t.TempDir(), "commands.log")
	promptFile := filepath.Join(t.TempDir(), "last-prompt.txt")
	h := piNewHarness(t, "finish", map[string]string{
		piFakeLogEnv:    commandsLog,
		piFakeRecordEnv: promptFile,
	})
	id, err := piSessionIdentity(RunSpec{})
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var calls []StopHookRequest
	stopHook := func(_ context.Context, req StopHookRequest) StopHookDecision {
		mu.Lock()
		calls = append(calls, req)
		n := len(calls)
		mu.Unlock()
		if n == 1 {
			return StopHookDecision{Action: "block", Reason: "Send your reply via teamhub message send."}
		}
		return StopHookDecision{Action: "allow"}
	}
	events, outcome := piCollect(t, h.start(t.Context(), "initial prompt", RunSpec{
		AssignSessionID: id,
		StopHook:        stopHook,
	}))
	if outcome.Status != statusCompleted || outcome.SessionID != id {
		t.Fatalf("outcome = %+v", outcome)
	}
	// Usage aggregates across both prompt passes (2+2 input, 3+3 output).
	if got := outcome.Usage["fixture/model"]; got.Input != 4 || got.Output != 6 {
		t.Fatalf("aggregated usage = %+v, want input=4 output=6", got)
	}
	// run.started (EventStatus with TurnID) is emitted exactly once.
	turnStarts := 0
	for _, event := range events {
		if event.Kind == EventStatus && event.TurnID != "" {
			turnStarts++
		}
	}
	if turnStarts != 1 {
		t.Fatalf("turnStarts = %d, want 1", turnStarts)
	}
	// The same Pi process received two prompt RPC commands.
	rawCommands, err := os.ReadFile(commandsLog)
	if err != nil {
		t.Fatal(err)
	}
	commands := strings.Fields(string(rawCommands))
	if !slices.Equal(commands, []string{"get_state", "prompt", "prompt"}) {
		t.Fatalf("commands = %v, want [get_state prompt prompt]", commands)
	}
	lastPrompt, err := os.ReadFile(promptFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(lastPrompt) != "Send your reply via teamhub message send." {
		t.Fatalf("lastPrompt = %q", string(lastPrompt))
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 || calls[0].Runtime != "pi" || calls[0].StopHookActive || !calls[1].StopHookActive {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestCodexBindingFingerprintSeparatesStopAndPermissionHooks(t *testing.T) {
	base := RunSpec{Dir: "/work", Model: "gpt-5"}
	none := codexBindingFingerprint("/home", "digest", base)
	stopOnly := codexBindingFingerprint("/home", "digest", RunSpec{
		Dir: "/work", Model: "gpt-5",
		CodexPermissionHook: &permission.CodexHook{StopHook: true},
	})
	reviewOnly := codexBindingFingerprint("/home", "digest", RunSpec{
		Dir: "/work", Model: "gpt-5",
		CodexPermissionHook: &permission.CodexHook{ReviewPermissions: true},
	})
	both := codexBindingFingerprint("/home", "digest", RunSpec{
		Dir: "/work", Model: "gpt-5",
		CodexPermissionHook: &permission.CodexHook{ReviewPermissions: true, StopHook: true},
	})
	if len(map[string]bool{none: true, stopOnly: true, reviewOnly: true, both: true}) != 4 {
		t.Fatalf("fingerprints collided: none=%s stop=%s review=%s both=%s", none, stopOnly, reviewOnly, both)
	}
}
