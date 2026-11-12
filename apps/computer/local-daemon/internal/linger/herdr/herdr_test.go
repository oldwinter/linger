package herdr

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeServer is a herdr socket API stand-in; tests never reach the user's
// herdr server.
type fakeServer struct {
	t        *testing.T
	socket   string
	mu       sync.Mutex
	agents   map[string]Agent
	tails    map[string]string
	requests []map[string]any
	streams  []net.Conn
}

func newFakeServer(t *testing.T) *fakeServer {
	t.Helper()
	// Unix socket paths are short on macOS; t.TempDir can exceed the limit.
	directory, err := os.MkdirTemp("", "herdr")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	server := &fakeServer{t: t, socket: filepath.Join(directory, "herdr.sock"), agents: map[string]Agent{}, tails: map[string]string{}}
	listener, err := net.Listen("unix", server.socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = listener.Close()
		server.mu.Lock()
		for _, stream := range server.streams {
			_ = stream.Close()
		}
		server.mu.Unlock()
	})
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go server.serve(connection)
		}
	}()
	return server
}

func (s *fakeServer) serve(connection net.Conn) {
	scanner := bufio.NewScanner(connection)
	for scanner.Scan() {
		var request map[string]any
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			continue
		}
		s.mu.Lock()
		s.requests = append(s.requests, request)
		params, _ := request["params"].(map[string]any)
		var result any
		var failure map[string]string
		switch request["method"] {
		case "agent.list":
			agents := []Agent{}
			for _, agent := range s.agents {
				agents = append(agents, agent)
			}
			result = map[string]any{"type": "agent_list", "agents": encodeAgents(agents)}
		case "agent.get":
			agent, ok := s.agents[params["target"].(string)]
			if ok {
				result = map[string]any{"type": "agent_info", "agent": encodeAgents([]Agent{agent})[0]}
			} else {
				failure = map[string]string{"code": "agent_not_found", "message": "no agent"}
			}
		case "pane.read":
			result = map[string]any{"type": "pane_read", "read": map[string]any{"text": s.tails[params["pane_id"].(string)]}}
		case "pane.send_input":
			result = map[string]any{"type": "ok"}
		case "events.subscribe":
			s.streams = append(s.streams, connection)
			result = map[string]any{"type": "subscription_started"}
		}
		s.mu.Unlock()
		response := map[string]any{"id": request["id"]}
		if failure != nil {
			response["error"] = failure
		} else {
			response["result"] = result
		}
		encoded, _ := json.Marshal(response)
		_, _ = connection.Write(append(encoded, '\n'))
	}
}

func encodeAgents(agents []Agent) []map[string]any {
	encoded := make([]map[string]any, 0, len(agents))
	for _, agent := range agents {
		encoded = append(encoded, map[string]any{
			"pane_id": agent.PaneID, "agent": agent.Agent, "agent_status": agent.Status, "cwd": agent.Cwd,
			"title": agent.Title, "state_change_seq": agent.StateChangeSeq, "terminal_id": "t", "workspace_id": "w1",
			"tab_id": "w1:t1", "focused": false, "revision": 1, "completion_seq": agent.CompletionSeq,
		})
	}
	return encoded
}

func (s *fakeServer) set(agent Agent) {
	s.mu.Lock()
	s.agents[agent.PaneID] = agent
	s.mu.Unlock()
}

// push sends one status event on every open subscription.
func (s *fakeServer) push(paneID, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	encoded, _ := json.Marshal(map[string]any{"event": "pane.agent_status_changed", "data": map[string]any{"pane_id": paneID, "workspace_id": "w1", "agent_status": status}})
	for _, stream := range s.streams {
		_, _ = stream.Write(append(encoded, '\n'))
	}
}

func (s *fakeServer) methods() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var methods []string
	for _, request := range s.requests {
		methods = append(methods, request["method"].(string))
	}
	return methods
}

func TestLocateUsesTheTerminalPathAndTheCLISocketDefault(t *testing.T) {
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "herdr"), []byte("#!/bin/sh\necho herdr 0.9.5\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	if _, ok := Locate(map[string]string{"PATH": "/nonexistent", "HOME": home}); ok {
		t.Fatal("herdr found without being on PATH")
	}
	installation, ok := Locate(map[string]string{"PATH": "/nonexistent:" + bin, "HOME": home})
	if !ok || installation.Executable != filepath.Join(bin, "herdr") || installation.Socket != filepath.Join(home, ".config", "herdr", "herdr.sock") {
		t.Fatalf("installation=%+v ok=%v", installation, ok)
	}
	if installation.Running() {
		t.Fatal("a missing socket is not a running server")
	}
	if version := installation.Version(t.Context()); version != "0.9.5" {
		t.Fatalf("version=%q", version)
	}
	for environment, want := range map[[2]string]string{
		{"XDG_CONFIG_HOME", "/xdg"}:              "/xdg/herdr/herdr.sock",
		{"HERDR_SOCKET_PATH", "/run/herdr.sock"}: "/run/herdr.sock",
	} {
		if got := SocketPath(map[string]string{"HOME": home, environment[0]: environment[1]}); got != want {
			t.Fatalf("%s: socket=%q, want %q", environment[0], got, want)
		}
	}
}

func TestTransitionsReportNewBlockedStatesAndFinishedWork(t *testing.T) {
	completion := func(value uint64) *uint64 { return &value }
	previous := map[string]Agent{
		"w1:p1": {PaneID: "w1:p1", Status: "working", StateChangeSeq: 4},
		"w1:p2": {PaneID: "w1:p2", Status: "blocked", StateChangeSeq: 7},
		"w1:p3": {PaneID: "w1:p3", Status: "blocked", StateChangeSeq: 2},
		"w1:p4": {PaneID: "w1:p4", Status: "idle", StateChangeSeq: 1},
		"w1:p5": {PaneID: "w1:p5", Status: "working", StateChangeSeq: 3},
		"w1:p7": {PaneID: "w1:p7", Status: "blocked", StateChangeSeq: 5, CompletionSeq: completion(1)},
		"w1:p8": {PaneID: "w1:p8", Status: "done", StateChangeSeq: 5, CompletionSeq: completion(2)},
	}
	current := map[string]Agent{
		"w1:p1": {PaneID: "w1:p1", Status: "blocked", StateChangeSeq: 5, Agent: "codex", Cwd: "/repo"},
		"w1:p2": {PaneID: "w1:p2", Status: "blocked", StateChangeSeq: 7},
		"w1:p3": {PaneID: "w1:p3", Status: "blocked", StateChangeSeq: 4},
		// Idle without completed work, such as a fresh agent, is not news.
		"w1:p4": {PaneID: "w1:p4", Status: "idle", StateChangeSeq: 2},
		"w1:p5": {PaneID: "w1:p5", Status: "done", StateChangeSeq: 4, CompletionSeq: completion(1)},
		"w1:p6": {PaneID: "w1:p6", Status: "blocked", StateChangeSeq: 1},
		// Answered and finished again between two lists.
		"w1:p7": {PaneID: "w1:p7", Status: "idle", StateChangeSeq: 8, CompletionSeq: completion(2)},
		"w1:p8": {PaneID: "w1:p8", Status: "idle", StateChangeSeq: 6, CompletionSeq: completion(2)},
	}
	if events := Transitions(nil, current); events != nil {
		t.Fatalf("the first list is a baseline, got %+v", events)
	}
	var got []string
	for _, event := range Transitions(previous, current) {
		got = append(got, event.PaneID+" "+event.Kind)
	}
	want := []string{"w1:p1 agent_blocked", "w1:p3 agent_blocked", "w1:p5 agent_finished", "w1:p6 agent_blocked", "w1:p7 agent_finished"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("transitions=%v, want %v", got, want)
	}
}

func TestRedactHidesObviousSecretsAndBoundsTheTail(t *testing.T) {
	text := strings.Join([]string{
		"export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
		`password: "hunter2 hunter2"`,
		"Authorization: Bearer abcdefghijklmnop.qrstuv",
		"token ghp_abcdefghijklmnopqrstuvwxyz0123",
		"-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXk=", "-----END OPENSSH PRIVATE KEY-----",
		"Use option A or B?",
	}, "\n")
	redacted := Redact(text)
	for _, secret := range []string{"sk-abc", "hunter2", "abcdefghijklmnop.qrstuv", "ghp_", "b3BlbnNzaC1rZXk"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("%q survived: %s", secret, redacted)
		}
	}
	if !strings.Contains(redacted, "OPENAI_API_KEY=[redacted]") || !strings.HasSuffix(redacted, "Use option A or B?") {
		t.Fatalf("redacted=%s", redacted)
	}
	long := Redact(strings.Repeat("line ééé\n", 2000) + "last")
	if len(long) > maxTailBytes || !strings.HasSuffix(long, "last") || !strings.HasPrefix(long, "line") {
		t.Fatalf("tail of %d bytes starts %q", len(long), long[:10])
	}
}

func TestAnswerReachesOnlyThePaneStillBlockedOnThatQuestion(t *testing.T) {
	server := newFakeServer(t)
	client := &Client{Socket: server.socket}
	server.set(Agent{PaneID: "w1:p1", Status: "blocked", StateChangeSeq: 9})
	server.set(Agent{PaneID: "w1:p2", Status: "working", StateChangeSeq: 3})
	for _, test := range []struct {
		pane, text string
		seq        uint64
		want       string
	}{
		{"w1:p1", "A", 8, AnswerPaneNotBlocked},
		{"w1:p2", "A", 3, AnswerPaneNotBlocked},
		{"w1:p9", "A", 1, AnswerPaneClosed},
		{"w1:p1", "A\nrm -rf ~", 9, AnswerInvalid},
		{"w1:p1", "A", 9, AnswerSent},
	} {
		status, err := client.Answer(t.Context(), test.pane, test.seq, test.text)
		if err != nil || status != test.want {
			t.Fatalf("%+v: status=%q err=%v", test, status, err)
		}
	}
	sends := 0
	server.mu.Lock()
	for _, request := range server.requests {
		if request["method"] == "pane.send_input" {
			sends++
			params := request["params"].(map[string]any)
			if params["pane_id"] != "w1:p1" || params["text"] != "A" || len(params["keys"].([]any)) != 1 || params["keys"].([]any)[0] != "enter" {
				t.Fatalf("send=%v", params)
			}
		}
	}
	server.mu.Unlock()
	if sends != 1 {
		t.Fatalf("sent %d answers", sends)
	}
	stopped := &Client{Socket: filepath.Join(t.TempDir(), "missing.sock")}
	if status, err := stopped.Answer(t.Context(), "w1:p1", 9, "A"); err != nil || status != AnswerUnavailable {
		t.Fatalf("stopped herdr: status=%q err=%v", status, err)
	}
}

func TestWatchEmitsOneEventPerPaneStateChange(t *testing.T) {
	server := newFakeServer(t)
	server.set(Agent{PaneID: "w1:p1", Agent: "codex", Status: "working", StateChangeSeq: 1, Cwd: "/repo"})
	server.tails["w1:p1"] = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\nA or B?"
	events := make(chan Event, 8)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() {
		done <- Watch(ctx, &Client{Socket: server.socket}, func(_ context.Context, event Event) error {
			events <- event
			return nil
		})
	}()
	waitFor(t, func() bool { return strings.Contains(strings.Join(server.methods(), ","), "events.subscribe") })

	server.set(Agent{PaneID: "w1:p1", Agent: "codex", Status: "blocked", StateChangeSeq: 2, Cwd: "/repo"})
	server.push("w1:p1", "blocked")
	server.push("w1:p1", "blocked")
	blocked := receive(t, events)
	if blocked.Kind != EventBlocked || blocked.PaneID != "w1:p1" || blocked.StateChangeSeq != 2 || blocked.Agent != "codex" ||
		blocked.Cwd != "/repo" || !strings.HasSuffix(blocked.Tail, "A or B?") || strings.Contains(blocked.Tail, "sk-abc") {
		t.Fatalf("blocked=%+v", blocked)
	}
	server.set(Agent{PaneID: "w1:p1", Agent: "codex", Status: "working", StateChangeSeq: 3})
	server.push("w1:p1", "working")
	completed := uint64(1)
	server.set(Agent{PaneID: "w1:p1", Agent: "codex", Status: "idle", StateChangeSeq: 4, CompletionSeq: &completed})
	server.push("w1:p1", "idle")
	if finished := receive(t, events); finished.Kind != EventFinished || finished.StateChangeSeq != 4 {
		t.Fatalf("finished=%+v", finished)
	}
	// A new agent pane renews the subscription so its changes are heard.
	server.set(Agent{PaneID: "w1:p2", Agent: "claude", Status: "working", StateChangeSeq: 1})
	server.push("w1:p1", "idle")
	waitFor(t, func() bool { return strings.Count(strings.Join(server.methods(), ","), "events.subscribe") == 2 })
	server.set(Agent{PaneID: "w1:p2", Agent: "claude", Status: "blocked", StateChangeSeq: 2})
	server.push("w1:p2", "blocked")
	if second := receive(t, events); second.PaneID != "w1:p2" || second.Kind != EventBlocked {
		t.Fatalf("second pane=%+v", second)
	}
	select {
	case extra := <-events:
		t.Fatalf("duplicate event %+v", extra)
	case <-time.After(3 * settle):
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("watch ended with %v", err)
	}
}

func receive(t *testing.T, events <-chan Event) Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(10 * time.Second):
		t.Fatal("no herdr event")
	}
	return Event{}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
