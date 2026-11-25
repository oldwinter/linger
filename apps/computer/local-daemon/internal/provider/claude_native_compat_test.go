package provider

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/native"
)

// TestNativeClaudeFirstRunResume drives a real Claude Code through the
// Executor against a loopback Anthropic Messages API: a first Run in which the
// model calls Bash, then a Run that resumes the same Session in a new process
// and must send the first Run's history back. It needs no credentials.
func TestNativeClaudeFirstRunResume(t *testing.T) {
	executable := os.Getenv("LINGER_CLAUDE_COMPAT_EXECUTABLE")
	if executable == "" {
		t.Skip("requires an explicitly selected native Claude executable")
	}
	model := newClaudeCompatModel()
	server := httptest.NewServer(model)
	defer server.Close()
	root := t.TempDir()
	// Registered after TempDir, so it runs first: a parked Claude resident
	// still writes under root until it stops.
	t.Cleanup(func() { _, _ = native.StopAllParkedResidents() })
	workspace := filepath.Join(root, "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	environment := map[string]string{
		"HOME": root, "PATH": os.Getenv("PATH"),
		"ANTHROPIC_API_KEY": "fixture-not-a-real-key", "ANTHROPIC_BASE_URL": server.URL,
		"DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1", "DISABLE_AUTOUPDATER": "1",
	}
	executor := Executor{RuntimeHomeRoot: filepath.Join(root, "runtime-homes"), TempBase: filepath.Join(root, "temp")}
	session := uuid.NewString()
	spec := OperationSpec{
		Provider: "claude", ExecutablePath: executable, WorkingDirectory: workspace, Environment: environment,
		Timeout: 90 * time.Second, TenantID: "compat-tenant", OwnerActorID: "compat-owner", AgentID: "compat-agent",
		ScopeID: "compat-context", OperationKind: "run.start", ThinkingLevel: "none", TaskID: "claude-compat-first",
		CreateProviderSessionID: session, Prompt: "Perform the local compatibility check.",
	}
	first := startClaudeLiveRun(t, t.Context(), &executor, spec).wait(t)
	if first.Status != "completed" || first.SessionID != session || !strings.Contains(first.Output, claudeCompatFirstReply) {
		t.Fatalf("first native Run failed: %+v", first)
	}
	if content, err := os.ReadFile(filepath.Join(workspace, "compat.txt")); err != nil || strings.TrimSpace(string(content)) != claudeCompatMarker {
		t.Fatalf("the model's Bash call did not run: %q %v", content, err)
	}
	// A new Executor starts a new Claude process, so the Session can only
	// continue from what Claude Code persisted.
	executor = Executor{RuntimeHomeRoot: executor.RuntimeHomeRoot, TempBase: executor.TempBase}
	spec.CreateProviderSessionID, spec.ResumeSessionID = "", session
	spec.TaskID, spec.Prompt = "claude-compat-resume", "Confirm the earlier check."
	second := startClaudeLiveRun(t, t.Context(), &executor, spec).wait(t)
	if second.Status != "completed" || second.SessionID != session || !strings.Contains(second.Output, claudeCompatResumeReply) {
		t.Fatalf("native Session did not resume: %+v", second)
	}
	if !model.resumedWithHistory() {
		t.Fatal("the resumed Run did not send the first Run's history to the model")
	}
}

const (
	claudeCompatMarker      = "linger-claude-compat"
	claudeCompatFirstReply  = "compatibility check finished"
	claudeCompatResumeReply = "earlier check confirmed"
)

// claudeCompatModel answers the Messages API: a request that offers tools and
// has no Bash result yet gets a Bash call, one that carries the result gets the
// first reply, and the resumed request (whose history already holds that
// reply) gets the resume reply. Requests without tools, such as Claude Code's
// own housekeeping calls, get a short text.
type claudeCompatModel struct {
	mu      sync.Mutex
	resumed bool
}

func newClaudeCompatModel() *claudeCompatModel { return &claudeCompatModel{} }

func (m *claudeCompatModel) resumedWithHistory() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.resumed
}

func (m *claudeCompatModel) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || !strings.HasSuffix(request.URL.Path, "/v1/messages") {
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, "{}")
		return
	}
	var body struct {
		Stream   bool              `json:"stream"`
		Tools    []json.RawMessage `json:"tools"`
		Messages []json.RawMessage `json:"messages"`
	}
	raw, _ := io.ReadAll(request.Body)
	if json.Unmarshal(raw, &body) != nil {
		response.WriteHeader(http.StatusBadRequest)
		return
	}
	history := string(raw)
	var block map[string]any
	switch {
	case len(body.Tools) == 0:
		block = map[string]any{"type": "text", "text": "ok"}
	case strings.Contains(history, claudeCompatFirstReply):
		m.mu.Lock()
		m.resumed = true
		m.mu.Unlock()
		block = map[string]any{"type": "text", "text": claudeCompatResumeReply}
	case strings.Contains(history, `"tool_result"`):
		block = map[string]any{"type": "text", "text": claudeCompatFirstReply}
	default:
		block = map[string]any{
			"type": "tool_use", "id": "toolu_compat", "name": "Bash",
			"input": map[string]any{"command": fmt.Sprintf("printf %s > compat.txt", claudeCompatMarker), "description": "Write the compatibility marker"},
		}
	}
	stop := "end_turn"
	if block["type"] == "tool_use" {
		stop = "tool_use"
	}
	if !body.Stream {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"id": "msg_compat", "type": "message", "role": "assistant", "model": "claude-compat",
			"content": []any{block}, "stop_reason": stop, "stop_sequence": nil,
			"usage": map[string]int{"input_tokens": 10, "output_tokens": 5},
		})
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	send := func(event string, data map[string]any) {
		encoded, _ := json.Marshal(data)
		_, _ = fmt.Fprintf(response, "event: %s\ndata: %s\n\n", event, encoded)
	}
	send("message_start", map[string]any{"type": "message_start", "message": map[string]any{
		"id": "msg_compat", "type": "message", "role": "assistant", "model": "claude-compat", "content": []any{},
		"stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 10, "output_tokens": 1},
	}})
	if block["type"] == "tool_use" {
		input, _ := json.Marshal(block["input"])
		send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": block["id"], "name": block["name"], "input": map[string]any{}}})
		send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "input_json_delta", "partial_json": string(input)}})
	} else {
		send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}})
		send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": block["text"]}})
	}
	send("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
	send("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stop, "stop_sequence": nil}, "usage": map[string]int{"output_tokens": 5}})
	send("message_stop", map[string]any{"type": "message_stop"})
}
