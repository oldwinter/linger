package herdrcore

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func strPtr(v string) *string { return &v }
func u64Ptr(v uint64) *uint64 { return &v }

func TestRedactHidesSecretsAndBoundsTail(t *testing.T) {
	text := strings.Join([]string{
		"export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
		`password: "hunter2 hunter2"`,
		"Authorization: Bearer abcdefghijklmnop.qrstuv",
		"token ghp_abcdefghijklmnopqrstuvwxyz0123",
		"-----BEGIN OPENSSH PRIVATE KEY-----",
		"b3BlbnNzaC1rZXk=",
		"-----END OPENSSH PRIVATE KEY-----",
		"Proceed with migration?",
	}, "\n")
	redacted := Redact(text)
	for _, secret := range []string{"sk-abc", "hunter2", "abcdefghijklmnop.qrstuv", "ghp_", "b3BlbnNzaC1rZXk"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("%q survived redaction: %s", secret, redacted)
		}
	}
	if !strings.Contains(redacted, "OPENAI_API_KEY=[redacted]") || !strings.HasSuffix(redacted, "Proceed with migration?") {
		t.Fatalf("redacted=%s", redacted)
	}
	long := Redact(strings.Repeat("line ééé\n", 2000) + "last")
	if len(long) > maxTailBytes || !strings.HasSuffix(long, "last") || !strings.HasPrefix(long, "line") {
		t.Fatalf("tail len=%d prefix=%q", len(long), long[:10])
	}
}

func TestTransitionsBlockedFinishedAndError(t *testing.T) {
	previous := map[string]Terminal{
		"t1":     {Address: "t1", State: TerminalStateLive, Turn: 0, Status: &Status{State: StatusWorking, App: "codex"}},
		"t2":     {Address: "t2", State: TerminalStateLive, Turn: 2, Status: &Status{State: StatusBlocked, Kind: strPtr(BlockedKindQuestion), Msg: "A or B?"}, StatusMS: u64Ptr(100)},
		"t3":     {Address: "t3", State: TerminalStateLive, Turn: 0, Status: &Status{State: StatusIdle}},
		"vps/t4": {Address: "vps/t4", State: TerminalStateLive, Turn: 1, Status: &Status{State: StatusWorking, App: "claude"}},
		"vps/t5": {Address: "vps/t5", State: TerminalStateLive, Turn: 3, Status: &Status{State: StatusWorking, App: "claude"}},
	}
	current := map[string]Terminal{
		// Working -> blocked (turn bumped).
		"t1": {Address: "t1", State: TerminalStateLive, Turn: 1, Status: &Status{State: StatusBlocked, Kind: strPtr(BlockedKindPermission), App: "codex", Msg: "Run rm?"}, StatusMS: u64Ptr(200), Cwd: "/repo", Labels: map[string]string{"linger.room": "r1"}},
		// Unchanged blocked state -> no duplicate.
		"t2": {Address: "t2", State: TerminalStateLive, Turn: 2, Status: &Status{State: StatusBlocked, Kind: strPtr(BlockedKindQuestion), Msg: "A or B?"}, StatusMS: u64Ptr(100)},
		// Fresh idle stays idle at turn 0 -> not news.
		"t3": {Address: "t3", State: TerminalStateLive, Turn: 0, Status: &Status{State: StatusIdle}},
		// Working -> idle with incremented turn -> finished.
		"vps/t4": {Address: "vps/t4", State: TerminalStateLive, Turn: 2, Status: &Status{State: StatusIdle, App: "claude"}, Foreground: &Foreground{Cwd: "/srv/app", Name: "claude"}},
		// Working -> error -> agent_error.
		"vps/t5": {Address: "vps/t5", State: TerminalStateLive, Turn: 4, Status: &Status{State: StatusError, App: "claude", Msg: "rate limit"}, StatusMS: u64Ptr(300)},
		// Brand-new terminal starting blocked -> agent_blocked.
		"t6": {Address: "t6", State: TerminalStateLive, Turn: 0, Status: &Status{State: StatusBlocked, Kind: strPtr(BlockedKindAuth), App: "codex"}},
	}

	if events := Transitions(nil, current); events != nil {
		t.Fatalf("nil baseline must produce no events, got %+v", events)
	}
	events := Transitions(previous, current)
	var got []string
	for _, ev := range events {
		got = append(got, ev.Address+":"+ev.Kind)
	}
	want := []string{"t1:agent_blocked", "t6:agent_blocked", "vps/t4:agent_finished", "vps/t5:agent_error"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("transitions=%v, want %v", got, want)
	}
	if events[0].Labels["linger.room"] != "r1" || events[0].Turn != 1 || events[0].StatusMS == nil || *events[0].StatusMS != 200 {
		t.Fatalf("t1 event=%+v", events[0])
	}
	if events[2].Cwd != "/srv/app" || events[2].Agent != "claude" {
		t.Fatalf("vps/t4 event=%+v", events[2])
	}
}

func TestAnswerTextAndKeysVerifyTurnAndRejectStale(t *testing.T) {
	srv := newFakeCoreServer(t)
	client := &Client{Socket: srv.socket}
	ctx := context.Background()

	srv.setTerminal(Terminal{
		Address: "vps/t7",
		State:   TerminalStateLive,
		Turn:    5,
		Status:  &Status{State: StatusBlocked, Kind: strPtr(BlockedKindQuestion), Msg: "Pick one"},
	})
	srv.setTerminal(Terminal{
		Address: "t2",
		State:   TerminalStateLive,
		Turn:    3,
		Status:  &Status{State: StatusWorking},
	})
	srv.setTerminal(Terminal{
		Address: "t3",
		State:   TerminalStateFinished,
		Turn:    1,
	})

	for _, tc := range []struct {
		addr string
		turn uint64
		text string
		want string
	}{
		{"vps/t7", 4, "yes", AnswerTerminalNotBlocked}, // stale turn
		{"t2", 3, "yes", AnswerTerminalNotBlocked},     // working, not blocked
		{"t3", 1, "yes", AnswerTerminalClosed},         // finished terminal
		{"missing", 1, "yes", AnswerTerminalClosed},    // not found
		{"vps/t7", 5, "ok\nrm -rf ~", AnswerInvalid},   // control char
		{"vps/t7", 5, "   ", AnswerInvalid},            // empty
		{"", 5, "yes", AnswerInvalid},                  // empty address
		{"vps/t7", 5, "Proceed with A", AnswerSent},    // valid
	} {
		status, err := client.AnswerText(ctx, tc.addr, tc.turn, tc.text)
		if err != nil || status != tc.want {
			t.Fatalf("AnswerText(%+v): status=%q err=%v, want %q", tc, status, err, tc.want)
		}
	}

	// Verify terminal.send used force=true and did NOT send invalid if="blocked".
	sends := 0
	for _, req := range srv.recordedRequests() {
		if req.Method == "terminal.send" {
			sends++
			if req.Params["terminal"] != "vps/t7" || req.Params["text"] != "Proceed with A" || req.Params["force"] != true {
				t.Fatalf("unexpected terminal.send params: %+v", req.Params)
			}
			if _, hasIf := req.Params["if"]; hasIf {
				t.Fatalf("terminal.send must not send invalid if=blocked: %+v", req.Params)
			}
		}
	}
	if sends != 1 {
		t.Fatalf("terminal.send count=%d, want 1", sends)
	}

	// AnswerKeys: stale turn, invalid key, and valid key sequence.
	if status, err := client.AnswerKeys(ctx, "vps/t7", 4, []string{"down", "enter"}); err != nil || status != AnswerTerminalNotBlocked {
		t.Fatalf("stale AnswerKeys: status=%q err=%v", status, err)
	}
	if status, err := client.AnswerKeys(ctx, "vps/t7", 5, nil); err != nil || status != AnswerInvalid {
		t.Fatalf("empty AnswerKeys: status=%q err=%v", status, err)
	}
	if status, err := client.AnswerKeys(ctx, "vps/t7", 5, []string{"down\n", "enter"}); err != nil || status != AnswerInvalid {
		t.Fatalf("control char AnswerKeys: status=%q err=%v", status, err)
	}
	if status, err := client.AnswerKeys(ctx, "vps/t7", 5, []string{"down", "enter"}); err != nil || status != AnswerSent {
		t.Fatalf("valid AnswerKeys: status=%q err=%v", status, err)
	}

	// Unavailable socket returns AnswerUnavailable without error.
	stopped := &Client{Socket: filepath.Join(t.TempDir(), "missing.sock")}
	if status, err := stopped.AnswerText(ctx, "vps/t7", 5, "yes"); err != nil || status != AnswerUnavailable {
		t.Fatalf("stopped AnswerText: status=%q err=%v", status, err)
	}
	if status, err := stopped.AnswerKeys(ctx, "vps/t7", 5, []string{"enter"}); err != nil || status != AnswerUnavailable {
		t.Fatalf("stopped AnswerKeys: status=%q err=%v", status, err)
	}

	// Transport drop AFTER pre-check returns error so caller marks outcome_unknown and never retries.
	srv.mu.Lock()
	srv.closeConnOnSend = true
	srv.mu.Unlock()
	if status, err := client.AnswerText(ctx, "vps/t7", 5, "retry?"); err == nil || status != "" {
		t.Fatalf("post-check drop should return error: status=%q err=%v", status, err)
	}
}

func TestWatchSnapshotEventsMissedResyncAndReconnect(t *testing.T) {
	srv := newFakeCoreServer(t)
	srv.setTerminal(Terminal{
		Address: "vps/t7",
		Name:    strPtr("worker"),
		State:   TerminalStateLive,
		Turn:    0,
		Cwd:     "/srv/app",
		Labels:  map[string]string{"linger.room": "room-42", "linger.agent": "agent-1"},
		Status:  &Status{State: StatusWorking, App: "codex"},
	})
	srv.setRead("vps/t7", "export API_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123\nAllow push?")

	events := make(chan Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- WatchWithOptions(ctx, &Client{Socket: srv.socket}, WatchOptions{
			Settle:       20 * time.Millisecond,
			RetryInitial: 20 * time.Millisecond,
			RetryMax:     50 * time.Millisecond,
		}, func(_ context.Context, ev Event) error {
			events <- ev
			return nil
		})
	}()

	waitForCondition(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.plainSubscribers) == 1
	})

	// Heartbeat must be ignored without errors.
	srv.pushPlainNotification("heartbeat", map[string]any{})

	// Simulate real herdr-core working -> blocked: status event immediately followed by turn event.
	blockedTerm := Terminal{
		Address:  "vps/t7",
		Name:     strPtr("worker"),
		State:    TerminalStateLive,
		Turn:     1,
		Cwd:      "/srv/app",
		Labels:   map[string]string{"linger.room": "room-42", "linger.agent": "agent-1"},
		Status:   &Status{State: StatusBlocked, Kind: strPtr(BlockedKindPermission), App: "codex", Msg: "Allow push?"},
		StatusMS: u64Ptr(1700000001000),
	}
	srv.setTerminal(blockedTerm)
	srv.pushEvent("vps/t7", "status", StatusEventData{Status: blockedTerm.Status, StatusMS: blockedTerm.StatusMS})
	srv.pushEvent("vps/t7", "turn", TurnEventData{State: StatusBlocked, Turn: 1})

	ev1 := receiveWatchEvent(t, events)
	if ev1.Kind != EventBlocked || ev1.Address != "vps/t7" || ev1.Turn != 1 || ev1.StatusMS == nil || *ev1.StatusMS != 1700000001000 ||
		ev1.Labels["linger.room"] != "room-42" || strings.Contains(ev1.Tail, "ghp_") || !strings.HasSuffix(ev1.Tail, "Allow push?") {
		t.Fatalf("ev1=%+v", ev1)
	}

	// No duplicate from the back-to-back status+turn events.
	select {
	case extra := <-events:
		t.Fatalf("unexpected duplicate event: %+v", extra)
	case <-time.After(80 * time.Millisecond):
	}

	// Simulate missed notification with a fresh snapshot where vps/t7 finished and t9 hit error.
	finishedTerm := Terminal{
		Address:  "vps/t7",
		Name:     strPtr("worker"),
		State:    TerminalStateLive,
		Turn:     2,
		Cwd:      "/srv/app",
		Labels:   map[string]string{"linger.room": "room-42"},
		Status:   &Status{State: StatusDone, App: "codex", Msg: "All tests pass"},
		StatusMS: u64Ptr(1700000002000),
	}
	errTerm := Terminal{
		Address:  "t9",
		State:    TerminalStateLive,
		Turn:     1,
		Cwd:      "/repo",
		Status:   &Status{State: StatusError, App: "claude", Msg: "API timeout"},
		StatusMS: u64Ptr(1700000003000),
	}
	srv.setTerminal(finishedTerm)
	srv.setTerminal(errTerm)
	srv.setRead("t9", "API timeout")
	srv.mu.Lock()
	srv.seq += 10
	missedSeq := srv.seq
	srv.mu.Unlock()
	srv.pushPlainNotification("missed", MissedNotification{
		Seq:       missedSeq,
		Terminals: []Terminal{finishedTerm, errTerm},
	})

	// Stale event with seq <= missedSeq must be ignored.
	srv.pushPlainNotification("event", EventNotification{
		Seq:      missedSeq - 1,
		Terminal: "vps/t7",
		Type:     "status",
		Data:     []byte(`{"status":{"state":"blocked"}}`),
	})

	evA := receiveWatchEvent(t, events)
	evB := receiveWatchEvent(t, events)
	seen := map[string]Event{evA.Address + ":" + evA.Kind: evA, evB.Address + ":" + evB.Kind: evB}
	if _, ok := seen["vps/t7:agent_finished"]; !ok {
		t.Fatalf("missing missed finished event: %+v", seen)
	}
	if errEv, ok := seen["t9:agent_error"]; !ok || errEv.Status == nil || errEv.Status.Msg != "API timeout" {
		t.Fatalf("missing missed error event: %+v", seen)
	}

	// Force disconnect and verify Watch reconnects with backoff and emits new transitions afterward.
	srv.closeAllSubscribers()
	waitForCondition(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.plainSubscribers) == 1
	})

	// After reconnect, baseline is current state; a NEW blocked transition must emit.
	reBlocked := Terminal{
		Address:  "t9",
		State:    TerminalStateLive,
		Turn:     2,
		Cwd:      "/repo",
		Status:   &Status{State: StatusBlocked, Kind: strPtr(BlockedKindQuestion), App: "claude", Msg: "Retry?"},
		StatusMS: u64Ptr(1700000009000),
	}
	srv.setTerminal(reBlocked)
	srv.pushEvent("t9", "status", StatusEventData{Status: reBlocked.Status, StatusMS: reBlocked.StatusMS})
	evAfterReconnect := receiveWatchEvent(t, events)
	if evAfterReconnect.Address != "t9" || evAfterReconnect.Kind != EventBlocked || evAfterReconnect.Turn != 2 {
		t.Fatalf("evAfterReconnect=%+v", evAfterReconnect)
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Watch ended with %v, want context.Canceled", err)
	}
}

func TestWatchEmitTerminalChangesAndParent(t *testing.T) {
	srv := newFakeCoreServer(t)
	events := make(chan Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- WatchWithOptions(ctx, &Client{Socket: srv.socket}, WatchOptions{
			Settle:              15 * time.Millisecond,
			RetryInitial:        20 * time.Millisecond,
			RetryMax:            50 * time.Millisecond,
			EmitTerminalChanges: true,
		}, func(_ context.Context, ev Event) error {
			events <- ev
			return nil
		})
	}()

	waitForCondition(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.plainSubscribers) == 1
	})

	created := Terminal{
		Address: "t10",
		Parent:  strPtr("t1"),
		State:   TerminalStateLive,
		Turn:    0,
		Status:  &Status{State: StatusWorking, App: "codex"},
	}
	srv.setTerminal(created)
	srv.pushEvent("t10", "created", created)

	ev1 := receiveWatchEvent(t, events)
	if ev1.Kind != EventTerminalChanged || ev1.Address != "t10" || ev1.Parent != "t1" {
		t.Fatalf("created event=%+v", ev1)
	}

	srv.pushEvent("t10", "removed", map[string]any{})
	ev2 := receiveWatchEvent(t, events)
	if ev2.Kind != EventTerminalChanged || ev2.Address != "t10" {
		t.Fatalf("removed event=%+v", ev2)
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Watch ended with %v, want context.Canceled", err)
	}
}

func receiveWatchEvent(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for watch event")
		return Event{}
	}
}

func waitForCondition(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(15 * time.Millisecond)
	}
}
