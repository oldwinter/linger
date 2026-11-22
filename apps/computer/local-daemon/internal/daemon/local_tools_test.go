package daemon

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/localtools"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/mcpproxy"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/permission"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider"
)

type localToolBinderFunc func(context.Context, provider.OperationSpec, mcpproxy.OperationIdentity, *mcpproxy.Set) error

func (localToolBinderFunc) BindUI(context.Context, provider.OperationSpec, mcpproxy.OperationIdentity, *mcpproxy.Set) error {
	return nil
}

func (f localToolBinderFunc) Bind(ctx context.Context, spec provider.OperationSpec, identity mcpproxy.OperationIdentity, set *mcpproxy.Set) error {
	return f(ctx, spec, identity, set)
}

func TestManagedToolCleanupCannotBecomeSuccessfulOrCancelledTerminal(t *testing.T) {
	for _, reason := range []string{"", "user_cancelled"} {
		t.Run(reason, func(t *testing.T) {
			d, stream, prepared := prepareDaemonFixture(t, &prepareBackend{}, true)
			command := startFromPrepare(prepared)
			d.openMCPProxies = mcpproxy.Open
			closed := 0
			d.localTools = localToolBinderFunc(func(_ context.Context, spec provider.OperationSpec, id mcpproxy.OperationIdentity, set *mcpproxy.Set) error {
				if id.OperationID != command.OperationID || spec.AgentID != command.AgentID {
					t.Fatal("local tool lost Operation identity")
				}
				return set.AddLocal(mcpproxy.LocalBinding{Name: "computer", URL: "http://127.0.0.1:1/mcp/fixture", ToolNames: []string{"screenshot"}, WaitReady: func(context.Context) error { return nil }, Close: func() error { closed++; return mcpproxy.ErrCleanupUnconfirmed }})
			})
			spec := provider.OperationSpec{AgentID: command.AgentID, Provider: "codex", MCPRelays: json.RawMessage(`[]`)}
			proxies, err := d.openOperationMCP(t.Context(), spec, mcpproxy.OperationIdentity{OperationID: command.OperationID, ExecutionLeaseID: command.ExecutionLeaseID, RuntimeType: "codex"})
			if err != nil {
				t.Fatal(err)
			}
			if names := proxies.LocalToolNames(); len(names) != 1 || names[0] != "mcp__computer__screenshot" {
				t.Fatal("trusted tool names were not preserved")
			}
			if _, err := d.ledger.Begin(t.Context(), operationIdentity(command)); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			d.activeOperations[command.OperationID] = &activeOperation{identity: operationIdentity(command), cancel: cancel, reason: reason, mcpProxies: proxies}
			d.finishOperation(ctx, command, spec, provider.Result{Status: "completed"})
			events := stream.snapshotEvents()
			if len(events) != 1 || events[0].Type != protocol.EventOperationFailed || !strings.Contains(string(events[0].Payload), "RUNTIME_CLEANUP_UNCONFIRMED") {
				t.Fatalf("unconfirmed tool cleanup became a normal terminal: %+v", events)
			}
			_ = proxies.Close()
			if closed != 1 {
				t.Fatalf("cleanup ran %d times", closed)
			}
		})
	}
}

type prewarmingLocalTools struct {
	prewarms atomic.Int32
	ctxs     chan context.Context
}

func (*prewarmingLocalTools) BindUI(context.Context, provider.OperationSpec, mcpproxy.OperationIdentity, *mcpproxy.Set) error {
	return nil
}

func (p *prewarmingLocalTools) Bind(context.Context, provider.OperationSpec, mcpproxy.OperationIdentity, *mcpproxy.Set) error {
	return nil
}

func (p *prewarmingLocalTools) Prewarm(ctx context.Context) {
	p.prewarms.Add(1)
	p.ctxs <- ctx
}

func TestWelcomePrewarmsLocalToolsOncePerProcess(t *testing.T) {
	device, err := transport.GenerateIdentity()
	if err != nil {
		t.Fatal(err)
	}
	tools := &prewarmingLocalTools{ctxs: make(chan context.Context, 4)}
	first := &fakeStream{commands: []protocol.Command{{Type: "runner.welcome", ConnectionEpoch: 1}}}
	second := &fakeStream{commands: []protocol.Command{{Type: "runner.welcome", ConnectionEpoch: 2}}}
	plane := &sequenceControlPlane{streams: []*fakeStream{first, second}}
	d, err := newTestDaemon(t, Options{ComputerID: "computer-1", ControlPlane: plane, IdentityStore: fakeStore{value: device}, OperationResolver: fakeOperationResolver{}, LocalTools: tools})
	if err != nil {
		t.Fatal(err)
	}
	// Each connection ends with EOF after its welcome; that end is expected.
	_ = d.runConnection(t.Context(), device)
	select {
	case <-tools.ctxs:
	case <-time.After(5 * time.Second):
		t.Fatal("welcome did not prewarm local tools")
	}
	_ = d.runConnection(t.Context(), device)
	// The second welcome has been handled; its prewarm, if any, would already
	// have started, so a short settle window proves there was none.
	time.Sleep(50 * time.Millisecond)
	if got := tools.prewarms.Load(); got != 1 {
		t.Fatalf("prewarm ran %d times across reconnect, want once", got)
	}
}

// The real Manager builds the public entry; the fixture supplies the private browser.
type fixtureUIBinder struct {
	*localtools.Manager
	browser mcpproxy.LocalBinding
}

func (b fixtureUIBinder) Bind(_ context.Context, _ provider.OperationSpec, _ mcpproxy.OperationIdentity, set *mcpproxy.Set) error {
	return set.AddLocal(b.browser)
}

type recordedUIReview struct{ payload map[string]any }

func (r *recordedUIReview) Request(_ string, payload map[string]any, respond func(json.RawMessage) error) error {
	r.payload = payload
	return respond(json.RawMessage(`{"decision":"deny","message":"confirmation required"}`))
}
func (*recordedUIReview) Forget(string) {}

func TestOperationMCPPublishesScriptEntryAndKeepsBrowserReview(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	entry, err := filepath.Abs("../../../node_modules/@playwright/mcp/cli.js")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := localtools.New(localtools.Options{NodePath: node, PlaywrightEntry: entry, StateDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := manager.Close(); err != nil {
			t.Error(err)
		}
	})
	driver := mcpproxy.LocalBinding{
		Name: "browser", URL: "http://127.0.0.1:1/mcp/browser", ToolNames: []string{"browser_click"},
		WaitReady: func(context.Context) error { return nil }, Close: func() error { return nil },
		Allowed: func(name string, input json.RawMessage) bool {
			return name == "browser_click" && string(input) == `{"target":"known"}`
		},
		Evidence: func(_ context.Context, name string, _ json.RawMessage) *permission.Evidence {
			if name != "browser_click" {
				t.Fatalf("unexpected evidence request for %s", name)
			}
			return &permission.Evidence{Browser: &permission.Browser{Title: "Test form", TargetName: "Submit"}}
		},
	}
	d := &Daemon{openMCPProxies: mcpproxy.Open, localTools: fixtureUIBinder{manager, driver}}
	spec := provider.OperationSpec{OperationKind: "run.start", PermissionReview: true}
	id := mcpproxy.OperationIdentity{OperationID: t.Name(), ExecutionLeaseID: "lease", RuntimeType: "codex"}
	set, err := d.openOperationMCP(t.Context(), spec, id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := set.Close(); err != nil {
			t.Error(err)
		}
	})
	if tools := set.LocalToolNames(); !slices.Equal(tools, []string{"mcp__computer__ui_exec", "mcp__computer__ui_reset"}) || strings.Contains(string(set.Config()), driver.URL) {
		t.Fatalf("unexpected public bindings: %v %s", tools, set.Config())
	}
	sink := &recordedUIReview{}
	release, err := set.RegisterToolReviewer(&permission.Reviewer{Requester: sink, LocalAllowed: set.LocalAllowed, LocalEvidence: set.LocalEvidence})
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err := set.ReviewTool(t.Context(), "browser", "browser_click", json.RawMessage(`{"target":"known"}`)); err != nil || sink.payload != nil {
		t.Fatalf("an allowed driver action requested approval: %v %+v", err, sink.payload)
	}
	if err := set.ReviewTool(t.Context(), "browser", "browser_click", json.RawMessage(`{"target":"confirm"}`)); err == nil {
		t.Fatal("expected the review denial")
	}
	data, err := json.Marshal(sink.payload)
	if err != nil {
		t.Fatal(err)
	}
	var request permission.Request
	if err := json.Unmarshal(data, &request); err != nil {
		t.Fatal(err)
	}
	if request.Action.Tool != "mcp__browser__browser_click" || request.Evidence == nil || request.Evidence.Browser == nil || request.Evidence.Browser.TargetName != "Submit" {
		t.Fatalf("driver permissions lost their original target: %+v", request)
	}
}
