package permission

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CodexHookTimeout is Codex's limit for one PermissionRequest hook. It stays above
// the Reviewer's own deadline, so a slow review answers unavailable before
// Codex abandons the hook.
const CodexHookTimeout = 90 * time.Second

// CodexStopHookTimeout is Codex's limit for one Stop hook. It stays above the
// Daemon's bridge deadline so a slow check fails open cleanly before Codex
// abandons the hook.
const CodexStopHookTimeout = 15 * time.Second

// maxHookEventBytes bounds one hook request; a patch is the largest input.
const maxHookEventBytes = 4 << 20

// CodexHandler judges one PermissionRequest of a registered Codex thread.
type CodexHandler func(ctx context.Context, event CodexHookEvent) Verdict

// CodexStopHookEvent is the part of Codex's Stop hook input the Daemon uses.
type CodexStopHookEvent struct {
	SessionID            string `json:"session_id"`
	TurnID               string `json:"turn_id"`
	StopHookActive       bool   `json:"stop_hook_active"`
	LastAssistantMessage string `json:"last_assistant_message"`
}

// CodexStopDecision is the Stop hook response for a Codex thread. When Block is
// true with a non-empty Reason, Codex continues the turn with Reason.
type CodexStopDecision struct {
	Block  bool
	Reason string
}

// CodexStopHandler decides whether a registered Codex thread may finish its turn.
type CodexStopHandler func(ctx context.Context, event CodexStopHookEvent) CodexStopDecision

// CodexEndpoint receives the PermissionRequest and Stop hooks of every Codex
// thread this Daemon runs. A resident app-server keeps a thread, and the hook
// commands configured for it, across Operations, so hooks reach one Daemon-wide
// address and are routed by thread to the Operation running it now.
type CodexEndpoint struct {
	url          string
	stopURL      string
	mu           sync.Mutex
	handlers     map[string]*registration
	stopHandlers map[string]*stopRegistration
}

type registration struct{ handler CodexHandler }
type stopRegistration struct{ handler CodexStopHandler }

var (
	sharedOnce     sync.Once
	sharedEndpoint *CodexEndpoint
	sharedErr      error
)

// CodexSharedEndpoint starts the Daemon's endpoint on first use: loopback only, on
// a random port, under a random path that only the hook command knows.
func CodexSharedEndpoint() (*CodexEndpoint, error) {
	sharedOnce.Do(func() { sharedEndpoint, sharedErr = newEndpoint() })
	return sharedEndpoint, sharedErr
}

func newEndpoint() (*CodexEndpoint, error) {
	var secret [24]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	token := hex.EncodeToString(secret[:])
	path := "/permission-request/" + token
	stopPath := "/stop/" + token
	endpoint := &CodexEndpoint{
		url:          "http://" + listener.Addr().String() + path,
		stopURL:      "http://" + listener.Addr().String() + stopPath,
		handlers:     map[string]*registration{},
		stopHandlers: map[string]*stopRegistration{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+path, endpoint.serve)
	mux.HandleFunc("POST "+stopPath, endpoint.serveStop)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return endpoint, nil
}

// HooksConfigFor builds the Codex `hooks` configuration for the requested
// managed hooks through the Daemon's own executable. Codex runs a Windows hook
// under `powershell -Command`, where a quoted path needs the call operator to
// run as a command.
func (e *CodexEndpoint) HooksConfigFor(daemonExecutable string, includePermission, includeStop bool) map[string]any {
	config := map[string]any{}
	if includePermission {
		config["PermissionRequest"] = []any{map[string]any{"hooks": []any{map[string]any{
			"type":           "command",
			"command":        shellQuote(daemonExecutable) + " permission-hook " + shellQuote(e.url),
			"commandWindows": "& " + powerShellQuote(daemonExecutable) + " permission-hook " + powerShellQuote(e.url),
			"timeout":        int(CodexHookTimeout / time.Second),
		}}}}
	}
	if includeStop {
		config["Stop"] = []any{map[string]any{"hooks": []any{map[string]any{
			"type":           "command",
			"command":        shellQuote(daemonExecutable) + " stop-hook " + shellQuote(e.stopURL),
			"commandWindows": "& " + powerShellQuote(daemonExecutable) + " stop-hook " + powerShellQuote(e.stopURL),
			"timeout":        int(CodexStopHookTimeout / time.Second),
		}}}}
	}
	return config
}

// Register routes a thread's hooks to handler until the returned function
// runs. A later registration for the same thread replaces it.
func (e *CodexEndpoint) Register(threadID string, handler CodexHandler) func() {
	entry := &registration{handler: handler}
	e.mu.Lock()
	e.handlers[threadID] = entry
	e.mu.Unlock()
	return func() {
		e.mu.Lock()
		if e.handlers[threadID] == entry {
			delete(e.handlers, threadID)
		}
		e.mu.Unlock()
	}
}

// RegisterStop routes a thread's Stop hooks to handler until the returned
// function runs. A later registration for the same thread replaces it.
func (e *CodexEndpoint) RegisterStop(threadID string, handler CodexStopHandler) func() {
	entry := &stopRegistration{handler: handler}
	e.mu.Lock()
	e.stopHandlers[threadID] = entry
	e.mu.Unlock()
	return func() {
		e.mu.Lock()
		if e.stopHandlers[threadID] == entry {
			delete(e.stopHandlers, threadID)
		}
		e.mu.Unlock()
	}
}

func (e *CodexEndpoint) serve(w http.ResponseWriter, r *http.Request) {
	var event CodexHookEvent
	if err := json.NewDecoder(io.LimitReader(r.Body, maxHookEventBytes)).Decode(&event); err != nil || event.SessionID == "" {
		http.Error(w, "invalid PermissionRequest hook input", http.StatusBadRequest)
		return
	}
	e.mu.Lock()
	entry := e.handlers[event.SessionID]
	e.mu.Unlock()
	verdict := Verdict{Decision: Unavailable, Message: UnavailableMessage}
	if entry != nil {
		// The request context ends when Codex abandons the hook.
		verdict = entry.handler(r.Context(), event)
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, CodexHookOutput(verdict))
}

func (e *CodexEndpoint) serveStop(w http.ResponseWriter, r *http.Request) {
	var event CodexStopHookEvent
	if err := json.NewDecoder(io.LimitReader(r.Body, maxHookEventBytes)).Decode(&event); err != nil || event.SessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, "{}")
		return
	}
	e.mu.Lock()
	entry := e.stopHandlers[event.SessionID]
	e.mu.Unlock()
	var decision CodexStopDecision
	if entry != nil {
		decision = entry.handler(r.Context(), event)
	}
	w.Header().Set("Content-Type", "application/json")
	if decision.Block && strings.TrimSpace(decision.Reason) != "" {
		encoded, _ := json.Marshal(map[string]any{
			"decision": "block",
			"reason":   strings.TrimSpace(decision.Reason),
		})
		_, _ = w.Write(encoded)
		return
	}
	_, _ = io.WriteString(w, "{}")
}

// CodexRunStopHook is the stop-hook command: it forwards the Stop hook input on
// stdin to the Daemon and prints the JSON answer. Any failure fails open by
// printing {} and exiting 0 so Codex is never trapped in a stop loop.
func CodexRunStopHook(stdin io.Reader, stdout, _ io.Writer, endpointURL string) int {
	allow := func() int {
		_, _ = io.WriteString(stdout, "{}\n")
		return 0
	}
	if !strings.HasPrefix(endpointURL, "http://127.0.0.1:") {
		return allow()
	}
	input, err := io.ReadAll(io.LimitReader(stdin, maxHookEventBytes+1))
	if err != nil || len(input) > maxHookEventBytes {
		return allow()
	}
	ctx, cancel := context.WithTimeout(context.Background(), CodexStopHookTimeout-2*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpointURL, bytes.NewReader(input))
	if err != nil {
		return allow()
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return allow()
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode != http.StatusOK {
		return allow()
	}
	_, _ = stdout.Write(body)
	return 0
}

// CodexRunHook is the permission-hook command: it forwards the hook input on stdin
// to the Daemon and prints the answer. Any failure exits 2 with the reason on
// stderr, which Codex treats as a denial with that message.
func CodexRunHook(stdin io.Reader, stdout, stderr io.Writer, endpointURL string) int {
	fail := func(reason string) int {
		_, _ = fmt.Fprintln(stderr, UnavailableMessage+" ("+reason+")")
		return 2
	}
	if !strings.HasPrefix(endpointURL, "http://127.0.0.1:") {
		return fail("invalid endpoint")
	}
	input, err := io.ReadAll(io.LimitReader(stdin, maxHookEventBytes+1))
	if err != nil || len(input) > maxHookEventBytes {
		return fail("invalid input")
	}
	ctx, cancel := context.WithTimeout(context.Background(), CodexHookTimeout-5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpointURL, bytes.NewReader(input))
	if err != nil {
		return fail("invalid endpoint")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fail("daemon unreachable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode != http.StatusOK {
		return fail(fmt.Sprintf("daemon status %d", response.StatusCode))
	}
	_, _ = stdout.Write(body)
	return 0
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func powerShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
