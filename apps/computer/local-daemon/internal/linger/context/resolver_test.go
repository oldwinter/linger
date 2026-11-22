package lingercontext

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/registration"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
)

func TestAuthorizedClaudeSkillsUseOnlyPublishedSkillRoots(t *testing.T) {
	names := authorizedClaudeSkillNames([]Mapping{
		{Kind: "skills", TargetPath: ".agents/skills", Access: "read_only", Files: []FileInput{{RelativePath: "approved/SKILL.md"}, {RelativePath: "approved/helper.sh"}, {RelativePath: "approved/nested/SKILL.md"}}},
		{Kind: "documents", TargetPath: ".agents/skills", Access: "read_only", Files: []FileInput{{RelativePath: "document/SKILL.md"}}},
		{Kind: "skills", TargetPath: "playground", Access: "read_only", Files: []FileInput{{RelativePath: "other/SKILL.md"}}},
		{Kind: "skills", TargetPath: ".agents/skills", Access: "read_write", Files: []FileInput{{RelativePath: "local/SKILL.md"}}},
	})
	if !reflect.DeepEqual(names, []string{"approved"}) {
		t.Fatalf("unexpected authorized skills: %v", names)
	}
}

// testContextViews resolves every Context to one workspace and authorizes no
// Claude Skills.
type testContextViews struct{ root string }

func (v testContextViews) ValidatedView(context.Context, string, json.RawMessage) (ViewRecord, error) {
	return ViewRecord{WorkspacePath: v.root}, nil
}

func TestExecutionResolverUsesOnlyLocalPathsAndEnvironment(t *testing.T) {
	resolver := ExecutionResolver{
		Providers: map[string]ProviderInstallation{
			"codex": {
				Type: "codex", ExecutablePath: "/local/bin/codex", Environment: map[string]string{"PATH": "/local/bin"},
				ContextWindows: map[string]int{"gpt-5": 272000, "local-small": 64896},
			},
		},
		WorkspaceGrants: map[string]WorkspaceGrant{
			"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"},
		},
		Views: testContextViews{root: "/local/workspace"},
		Registrations: map[string]RegistrationBinding{
			"registration-codex": {RegistrationID: "registration-codex", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "codex", Status: registration.StatusOnline},
		},
	}
	request := json.RawMessage(`{
		"kind":"run.start",
		"runtime":{"type":"codex","model":"gpt-5","reasoning_effort":"xhigh"},
		"session_options":{"thread_name":"Reviewer","base_instructions":"Base","developer_instructions":"Developer"},
		"session":{"thread_id":"thread-1"},
		"input":{"type":"text","text":"Review this"},
		"run_context":{"execution_run_ref":"run-123"},
		"run_resources":{"mcp_servers":[{"name":"teamhub","relay_url":"https://relay.test/mcp","relay_token":"secret","tool_names":[],"expires_at":"2026-09-02T10:00:00Z"}]},
		"executable_path":"/remote/evil",
		"working_directory":"/remote/evil",
		"environment":{"TOKEN":"secret"}
	}`)
	spec, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 2,
		WorkspaceGrantID: "grant-local", RuntimeType: "codex", HostAccess: "trusted", OperationID: "operation-456",
		ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, request)
	if err != nil {
		t.Fatal(err)
	}
	if spec.ExecutablePath != "/local/bin/codex" || spec.WorkingDirectory != "/local/workspace" || spec.Environment["TOKEN"] != "" {
		t.Fatalf("resolver accepted remote execution authority: %+v", spec)
	}
	if spec.Prompt != "Review this" || spec.ResumeSessionID != "thread-1" || spec.ThinkingLevel != "xhigh" ||
		spec.ContextWindow != 272000 || spec.ExecutionRunRef != "run-123" ||
		spec.SystemPrompt != "Base\n\nDeveloper\n\n"+trustedHostServiceInstructions+"\n\n"+boundServiceInstructions(nil) ||
		string(spec.MCPRelays) == "" {
		t.Fatalf("semantic request was not preserved: %+v", spec)
	}
}

func TestExecutionResolverAddsCodexLocalDefaults(t *testing.T) {
	resolver := ExecutionResolver{
		Providers:       map[string]ProviderInstallation{"codex": {Type: "codex", ExecutablePath: "/local/bin/codex"}, "claude": {Type: "claude", ExecutablePath: "/local/bin/claude"}},
		WorkspaceGrants: map[string]WorkspaceGrant{"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"}},
		Views:           testContextViews{root: "/local/workspace"},
		Registrations: map[string]RegistrationBinding{
			"registration-codex":  {RegistrationID: "registration-codex", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "codex", Status: registration.StatusOnline},
			"registration-claude": {RegistrationID: "registration-claude", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "claude", Status: registration.StatusOnline},
		},
	}
	codex, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 1,
		WorkspaceGrantID: "grant-local", RuntimeType: "codex", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"codex","model":"gpt-5"},"session":{"threadId":"thread-1"},"input":{"type":"text","text":"Go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"--config", `model_reasoning_summary="auto"`, "--config", "hide_agent_reasoning=false"}
	if !reflect.DeepEqual(codex.ExtraArgs, want) {
		t.Fatalf("codex ExtraArgs = %v, want %v", codex.ExtraArgs, want)
	}

	claude, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-claude", AssignmentRevision: 1,
		WorkspaceGrantID: "grant-local", RuntimeType: "claude",
		ExecutionContextKey: "context-1", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"claude","model":"claude-sonnet-5"},"session":{},"input":{"type":"text","text":"Go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(claude.ExtraArgs) != 0 {
		t.Fatalf("Codex-only defaults leaked into %s: %v", claude.Provider, claude.ExtraArgs)
	}
}

func TestExecutionResolverRejectsAssignmentAndScopeMismatch(t *testing.T) {
	resolver := ExecutionResolver{}
	if _, err := resolver.Resolve(context.Background(), protocol.Command{}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("Operation without Assignment was accepted")
	}
}

func TestExecutionResolverRequiresExplicitCodexFirstRunMarker(t *testing.T) {
	resolver := ExecutionResolver{
		Providers:       map[string]ProviderInstallation{"codex": {Type: "codex", ExecutablePath: "/local/bin/codex"}},
		WorkspaceGrants: map[string]WorkspaceGrant{"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"}},
		Views:           testContextViews{root: "/local/workspace"},
		Registrations:   map[string]RegistrationBinding{"registration-codex": {RegistrationID: "registration-codex", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "codex", Status: registration.StatusOnline}},
	}
	command := protocol.Command{TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 1, WorkspaceGrantID: "grant-local", RuntimeType: "codex",
		ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`)}
	for _, session := range []string{`{}`, `{"threadId":null}`, `{"threadId":""}`, `{"threadId":"retained"}`} {
		request := json.RawMessage(`{"kind":"run.start","runtime":{"type":"codex"},"session":` + session + `,"input":{"text":"Run"}}`)
		spec, err := resolver.Resolve(context.Background(), command, request)
		accepted := session == `{"threadId":""}` || session == `{"threadId":"retained"}`
		if (err == nil) != accepted {
			t.Fatalf("Session %s admission=%v", session, err)
		}
		if session == `{"threadId":"retained"}` && spec.ResumeSessionID != "retained" {
			t.Fatal("retained Session became a create")
		}
	}
}

func TestExecutionResolverRejectsInactiveRegistration(t *testing.T) {
	for _, status := range []registration.Status{
		registration.StatusOffline, registration.StatusUnavailable,
	} {
		resolver := ExecutionResolver{
			Providers: map[string]ProviderInstallation{
				"codex": {Type: "codex", ExecutablePath: "/local/bin/codex"},
			},
			WorkspaceGrants: map[string]WorkspaceGrant{
				"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"},
			},
			Views: testContextViews{root: "/local/workspace"},
			Registrations: map[string]RegistrationBinding{
				"registration-codex": {
					RegistrationID: "registration-codex", TenantID: "tenant-acme",
					OwnerActorID: "actor-alice", ProviderType: "codex", Status: status,
				},
			},
		}
		_, err := resolver.Resolve(context.Background(), protocol.Command{
			TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 2,
			WorkspaceGrantID: "grant-local", RuntimeType: "codex",
		}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"codex"},"input":{"text":"Run"}}`))
		if err == nil {
			t.Fatalf("inactive Registration status %q was accepted", status)
		}
	}
}

func TestExecutionResolverRejectsUnknownReasoningEffort(t *testing.T) {
	resolver := ExecutionResolver{
		Providers: map[string]ProviderInstallation{
			"codex": {Type: "codex", ExecutablePath: "/local/bin/codex"},
		},
		WorkspaceGrants: map[string]WorkspaceGrant{
			"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"},
		},
		Views: testContextViews{root: "/local/workspace"},
		Registrations: map[string]RegistrationBinding{
			"registration-codex": {RegistrationID: "registration-codex", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "codex", Status: registration.StatusOnline},
		},
	}
	_, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 2,
		WorkspaceGrantID: "grant-local", RuntimeType: "codex", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"codex","reasoning_effort":"future"},"input":{"text":"Run"}}`))
	if err == nil {
		t.Fatal("unknown Runtime reasoning effort was accepted")
	}
}

func TestExecutionResolverUsesSessionMarkerState(t *testing.T) {
	for _, runtimeType := range []string{"claude", "pi"} {
		t.Run(runtimeType, func(t *testing.T) {
			resolver := ExecutionResolver{
				Providers: map[string]ProviderInstallation{
					runtimeType: {Type: runtimeType, ExecutablePath: "/local/bin/" + runtimeType},
				},
				WorkspaceGrants: map[string]WorkspaceGrant{
					"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"},
				},
				Views: testContextViews{root: "/local/workspace"},
				Registrations: map[string]RegistrationBinding{
					"registration-claude": {RegistrationID: "registration-claude", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: runtimeType, Status: registration.StatusOnline},
				},
			}
			command := protocol.Command{
				TenantID: "tenant-acme", RegistrationID: "registration-claude", AssignmentRevision: 2,
				WorkspaceGrantID: "grant-local", RuntimeType: runtimeType,
				ExecutionContextKey: "context-1", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
			}
			request := func(materialized, resumeAfterYield bool) json.RawMessage {
				return json.RawMessage(fmt.Sprintf(`{
			"kind":"run.start","runtime":{"type":%q},
			"session_options":{"thread_name":"Claude"},
			"session":{"provider":%q,"sessionId":"123e4567-e89b-12d3-a456-426614174000","lingerMaterialized":%t},
			"run_context":{"resume_after_yield":%t},
			"input":{"type":"text","text":"Run"},"run_resources":{"mcp_servers":[]}
		}`, runtimeType, runtimeType, materialized, resumeAfterYield))
			}
			first, err := resolver.Resolve(context.Background(), command, request(false, false))
			if err != nil || first.CreateProviderSessionID == "" || first.ResumeSessionID != "" {
				t.Fatalf("unmaterialized Runtime spec=%+v err=%v", first, err)
			}
			resumed, err := resolver.Resolve(context.Background(), command, request(true, false))
			if err != nil || resumed.CreateProviderSessionID != "" || resumed.ResumeSessionID != "123e4567-e89b-12d3-a456-426614174000" {
				t.Fatalf("materialized Runtime spec=%+v err=%v", resumed, err)
			}

			yielded, err := resolver.Resolve(t.Context(), command, request(false, true))
			if err != nil || !yielded.ResumeAfterYield || yielded.CreateProviderSessionID != "" || yielded.ResumeSessionID != resumed.ResumeSessionID {
				t.Fatalf("yielded first turn must resume its assigned identity: %+v, %v", yielded, err)
			}
			_, err = resolver.Resolve(t.Context(), command, json.RawMessage(fmt.Sprintf(`{"kind":"run.start","runtime":{"type":%q},"run_context":{"resume_after_yield":true}}`, runtimeType)))
			if err == nil {
				t.Fatal("scheduler continuation accepted an empty session")
			}
		})
	}
}

func TestExecutionResolverAppendsToolGuide(t *testing.T) {
	resolver := ExecutionResolver{
		Providers:       map[string]ProviderInstallation{"codex": {Type: "codex", ExecutablePath: "/local/bin/codex"}},
		WorkspaceGrants: map[string]WorkspaceGrant{"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"}},
		Views:           testContextViews{root: "/local/workspace"},
		Registrations: map[string]RegistrationBinding{
			"registration-codex": {RegistrationID: "registration-codex", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "codex", Status: registration.StatusOnline},
		},
		ToolGuide: "Guide",
	}
	spec, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-codex", AssignmentRevision: 1,
		WorkspaceGrantID: "grant-local", RuntimeType: "codex", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"codex","model":"gpt-5"},"session_options":{"base_instructions":"Base","developer_instructions":"Developer"},"session":{"threadId":"thread-1"},"input":{"type":"text","text":"Go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if spec.DeveloperInstructions == nil || *spec.DeveloperInstructions != "Developer\n\nGuide" || spec.SystemPrompt != "Base\n\nDeveloper\n\nGuide" {
		t.Fatalf("tool guide missing: %+v", spec)
	}
}

// Claude defers its web tools behind ToolSearch, so every Claude Operation
// names them; Codex has its own web_search and gets nothing.
func TestExecutionResolverNamesClaudeWebTools(t *testing.T) {
	for _, runtimeType := range []string{"claude", "codex"} {
		t.Run(runtimeType, func(t *testing.T) {
			resolver := ExecutionResolver{
				Providers:       map[string]ProviderInstallation{runtimeType: {Type: runtimeType, ExecutablePath: "/local/bin/" + runtimeType}},
				WorkspaceGrants: map[string]WorkspaceGrant{"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"}},
				Views:           testContextViews{root: "/local/workspace"},
				Registrations: map[string]RegistrationBinding{
					"registration-local": {RegistrationID: "registration-local", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: runtimeType, Status: registration.StatusOnline},
				},
			}
			spec, err := resolver.Resolve(context.Background(), protocol.Command{
				TenantID: "tenant-acme", RegistrationID: "registration-local", AssignmentRevision: 1,
				WorkspaceGrantID: "grant-local", RuntimeType: runtimeType, ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
			}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"`+runtimeType+`","model":"m"},"session_options":{"base_instructions":"Base","developer_instructions":"Developer"},"session":{"threadId":"thread-1"},"input":{"type":"text","text":"Go"}}`))
			if err != nil {
				t.Fatal(err)
			}
			if runtimeType == "claude" {
				if spec.SystemPrompt != "Base\n\nDeveloper\n\n"+claudeWebToolGuide {
					t.Fatalf("Claude web tools not named: %+v", spec)
				}
			} else if strings.Contains(spec.SystemPrompt, "select:WebSearch,WebFetch") || spec.DeveloperInstructions == nil || *spec.DeveloperInstructions != "Developer" {
				t.Fatalf("Codex got the Claude web tool guide: %+v", spec)
			}
		})
	}
}

func TestWebToolGuideFollowsTheModelLink(t *testing.T) {
	cases := []struct {
		runtimeType           string
		apiLink, gateway, cli bool
		want, notWant         string
	}{
		{"claude", false, false, true, "select:WebSearch,WebFetch", ""},
		{"claude", false, false, true, "Use them first. If that fails, `teamhub web search <query>`", ""},
		{"codex", false, false, true, "use your built-in web search first. If that fails, `teamhub web search", "select:WebSearch"},
		{"claude", true, false, true, "instead of your built-in web search and fetch tools", "select:WebSearch"},
		{"codex", true, false, true, "Web tools: search the web with `teamhub web search <query>`", "first"},
		{"claude", true, true, true, "Web tools: search the web with `teamhub web search <query>`", "built-in"},
		{"codex", true, true, true, "`teamhub web list`", "built-in"},
		{"pi", false, false, true, "`teamhub web open <url>`", "built-in"},
		{"pi", true, false, true, "`teamhub web open <url>`", "built-in"},
		{"claude", false, false, false, "select:WebSearch,WebFetch", "teamhub"},
		{"claude", true, false, false, "select:WebSearch,WebFetch", "teamhub"},
	}
	for _, c := range cases {
		guide := webToolGuide(c.runtimeType, c.apiLink, c.gateway, c.cli)
		if !strings.Contains(guide, c.want) || (c.notWant != "" && strings.Contains(guide, c.notWant)) {
			t.Fatalf("webToolGuide(%s, api=%v, gateway=%v, cli=%v) = %q", c.runtimeType, c.apiLink, c.gateway, c.cli, guide)
		}
	}
	if webToolGuide("codex", true, true, false) != "" || webToolGuide("pi", false, false, false) != "" {
		t.Fatal("a guide named teamhub without the TeamHub CLI")
	}
}

func TestExecutionResolverTurnsOffNativeWebToolsOnTheGateway(t *testing.T) {
	resolver := ExecutionResolver{
		Providers:       map[string]ProviderInstallation{"claude": {Type: "claude", ExecutablePath: "/local/bin/claude", ModelGateway: true, APILink: true}},
		WorkspaceGrants: map[string]WorkspaceGrant{"grant-local": {GrantID: "grant-local", TenantID: "tenant-acme", Path: "/local/workspace"}},
		Views:           testContextViews{root: "/local/workspace"},
		Registrations: map[string]RegistrationBinding{
			"registration-local": {RegistrationID: "registration-local", TenantID: "tenant-acme", OwnerActorID: "actor-alice", ProviderType: "claude", Status: registration.StatusOnline},
		},
	}
	spec, err := resolver.Resolve(context.Background(), protocol.Command{
		TenantID: "tenant-acme", RegistrationID: "registration-local", AssignmentRevision: 1,
		WorkspaceGrantID: "grant-local", RuntimeType: "claude", ContextViewRef: json.RawMessage(`{"receipt_ref":"receipt-1"}`),
	}, json.RawMessage(`{"kind":"run.start","runtime":{"type":"claude","model":"m"},"session_options":{"base_instructions":"Base","developer_instructions":"Developer"},"session":{"threadId":"thread-1"},"input":{"type":"text","text":"Go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !spec.WithoutNativeWebTools || strings.Contains(spec.SystemPrompt, "WebSearch") {
		t.Fatalf("gateway Claude keeps its web tools: %+v", spec)
	}
}

func TestBoundServiceGuidanceUsesLocalCommandOnly(t *testing.T) {
	command := []string{"/opt/node", "/private install/cli.js", "--config", "/private/current.json"}
	text := boundServiceInstructions(command)
	if !strings.Contains(text, `/private/current.json`) || !strings.Contains(text, "Do not invoke the bare global") {
		t.Fatal("missing bound service command")
	}
	if !strings.Contains(boundServiceInstructions(nil), "unavailable") {
		t.Fatal("unbound service availability was invented")
	}
}

// The Context Skill identity comes from the View's own file digests.
func TestContextSkillDigest(t *testing.T) {
	skills := func(files ...FileInput) Mapping {
		return Mapping{Kind: "skills", TargetPath: ".agents/skills", Access: "read_only", Files: files}
	}
	a := FileInput{RelativePath: "a/SKILL.md", SHA256: "1"}
	b := FileInput{RelativePath: "b/run.sh", SHA256: "2", Executable: true}
	base := contextSkillDigest([]Mapping{skills(a, b)})
	if contextSkillDigest([]Mapping{skills(b, a), {Kind: "documents", TargetPath: "documents", Files: []FileInput{a}}}) != base {
		t.Fatal("order or another mapping changed the digest")
	}
	edited := a
	edited.SHA256 = "3"
	notExecutable := b
	notExecutable.Executable = false
	for _, changed := range [][]FileInput{{edited, b}, {a, notExecutable}, {a}} {
		if contextSkillDigest([]Mapping{skills(changed...)}) == base {
			t.Fatalf("%+v kept the digest", changed)
		}
	}
}
