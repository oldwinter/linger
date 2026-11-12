package permission

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

// Read-only herdr commands run like any other read-only command; everything
// that hands text to a pane or changes the session is reviewed, because the
// pane's shell, working directory, and foreground program are unknown.
func TestShellClassifiesHerdrCommands(t *testing.T) {
	workspace := shellWorkspace(t)
	for _, test := range []struct {
		command string
		want    ShellDecision
	}{
		{"herdr --version", ShellAllow},
		{"herdr status", ShellAllow},
		{"herdr api schema --json", ShellAllow},
		{"herdr agent list", ShellAllow},
		{"herdr agent get reviewer", ShellAllow},
		{"herdr agent read reviewer --source recent-unwrapped --lines 120", ShellAllow},
		{"herdr agent wait reviewer --until blocked --timeout 120000", ShellAllow},
		{"herdr pane list --workspace w2", ShellAllow},
		{"herdr pane read w2:p1 --source recent --lines 80 | tail -20", ShellAllow},
		{`herdr pane wait-output w2:p1 --match "test result" --timeout 120000`, ShellAllow},
		{"herdr workspace list", ShellAllow},
		{"herdr tab list --workspace w2", ShellAllow},
		{"herdr agent list > notes/agents.json", ShellReview},
		{"herdr --session scratch agent list", ShellReview},
		{"herdr --machine build agent list", ShellReview},
		{"herdr", ShellReview},
		{"herdr --version --skill", ShellReview},
		{"herdr workspace create --cwd notes --label linger --no-focus", ShellReview},
		{"herdr pane split w2:p1 --direction right --no-focus", ShellReview},
		{"herdr pane close w2:p2", ShellReview},
		{"herdr server stop", ShellReview},
		{`herdr pane run w2:p2 "ls -la"`, ShellReview},
		{`herdr pane run w2:p2 "rm -rf ../other-project"`, ShellReview},
		{"herdr pane send-text w1:p1 'git push --force'", ShellReview},
		{"herdr pane send-keys w1:p1 enter", ShellReview},
		{`herdr agent prompt reviewer "Review the diff" --wait --timeout 120000`, ShellReview},
		{"herdr agent start reviewer --kind codex --pane w2:p2", ShellReview},
		{"herdr agent send-keys reviewer y", ShellReview},
	} {
		if decision, _ := Shell(test.command, workspace, workspace, shellCommands); decision != test.want {
			t.Errorf("%q: decision %d, want %d", test.command, decision, test.want)
		}
	}
}

func TestHerdrDelegationsNameTheTextAPaneReceives(t *testing.T) {
	for _, test := range []struct {
		command string
		want    []Delegation
		unread  bool
	}{
		{`herdr pane run w2:p2 "rm -rf ../other-project"`, []Delegation{{Kind: DelegationShellCommand, Target: "w2:p2", Text: "rm -rf ../other-project"}}, false},
		{"herdr --session work pane send-text w1:p1 'git push --force'", []Delegation{{Kind: DelegationTerminalInput, Target: "w1:p1", Text: "git push --force"}}, false},
		{"herdr pane send-keys w1:p1 ctrl+c enter", []Delegation{{Kind: DelegationTerminalInput, Target: "w1:p1", Text: "ctrl+c enter"}}, false},
		{"herdr agent send-keys reviewer y", []Delegation{{Kind: DelegationTerminalInput, Target: "reviewer", Text: "y"}}, false},
		{
			`herdr agent prompt reviewer "Review the current diff; report findings only." --wait --until blocked --timeout 120000`,
			[]Delegation{{Kind: DelegationAgentPrompt, Target: "reviewer", Text: "Review the current diff; report findings only."}}, false,
		},
		{
			"herdr agent start reviewer --kind codex --pane w2:p2 --timeout 60000 -- --dangerously-bypass-approvals-and-sandbox",
			[]Delegation{{Kind: DelegationAgentStart, Target: "w2:p2", Agent: "codex", Text: "--dangerously-bypass-approvals-and-sandbox"}}, false,
		},
		{
			"cd notes && herdr pane run w2:p2 'make test' && herdr agent prompt reviewer 'Fix the failures'",
			[]Delegation{{Kind: DelegationShellCommand, Target: "w2:p2", Text: "make test"}, {Kind: DelegationAgentPrompt, Target: "reviewer", Text: "Fix the failures"}}, false,
		},
		{"herdr agent list", nil, false},
		{"herdr pane run w2:p2", nil, false},
		{`herdr agent prompt reviewer "Use $HOME"`, nil, true},
		{`ls && herdr pane run w2:p2 "$(cat cmd)"`, nil, true},
		{`echo "$HOME"`, nil, false},
	} {
		delegations, unread := HerdrDelegations(test.command)
		if !reflect.DeepEqual(delegations, test.want) || unread != test.unread {
			t.Errorf("%q: delegations %+v unread %v", test.command, delegations, unread)
		}
	}
}

func TestReviewerReviewsHerdrDelegationsWithTheirText(t *testing.T) {
	workspace := shellWorkspace(t)
	for _, test := range []struct {
		name     string
		evidence *Evidence
		command  string
		want     string
	}{
		{
			name:    "an inner command that leaves the workspace",
			command: `herdr pane run w2:p2 "rm -rf ../other-project"`,
			want:    `{"delegations":[{"kind":"shell_command","target":"w2:p2","text":"rm -rf ../other-project"}]}`,
		},
		{
			name:    "a prompt for an unreviewed coding agent",
			command: `herdr agent prompt reviewer "Push the release branch" --wait`,
			want:    `{"delegations":[{"kind":"agent_prompt","target":"reviewer","text":"Push the release branch"}]}`,
		},
		{
			name:     "next to the adapter's script evidence",
			evidence: &Evidence{Script: &Script{Path: "setup.sh", Body: "echo hi"}, Missing: []string{"adapter gap"}},
			command:  "bash setup.sh && herdr agent start reviewer --kind claude --pane w2:p2",
			want:     `{"script":{"path":"setup.sh","body":"echo hi"},"delegations":[{"kind":"agent_start","target":"w2:p2","agent":"claude","text":""}],"missing":["adapter gap"]}`,
		},
		{
			name:    "shell syntax the host does not read",
			command: `herdr agent prompt reviewer "Deploy $BRANCH"`,
			want:    `{"missing":["` + HerdrUnreadMissing + `"]}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			requester := newFakeRequester()
			reviewer := &Reviewer{Requester: requester, Environment: Environment{Workspace: workspace}}
			verdict := review(reviewer, Request{Action: Action{Runtime: "claude", Tool: "Bash", Command: test.command}, Evidence: test.evidence})
			id := <-requester.sent
			evidence, _ := json.Marshal(requester.requests[id]["evidence"])
			var got, want any
			_ = json.Unmarshal(evidence, &got)
			if err := json.Unmarshal([]byte(test.want), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("evidence %s, want %s", evidence, test.want)
			}
			requester.answer(t, id, `{"decision":"needs_approval","message":"card"}`)
			if got := <-verdict; got.Decision != NeedsApproval {
				t.Fatalf("verdict %+v", got)
			}
			if test.evidence != nil && len(test.evidence.Missing) != 1 {
				t.Fatalf("the adapter's evidence changed: %+v", test.evidence)
			}
		})
	}
}

func TestReviewerAllowsReadOnlyHerdrCommandsWithoutAsking(t *testing.T) {
	requester := newFakeRequester()
	workspace := shellWorkspace(t)
	reviewer := &Reviewer{Requester: requester, Environment: Environment{Workspace: workspace}}
	for _, runtime := range []string{"claude", "codex"} {
		for _, command := range []string{"herdr agent list", "herdr pane read w2:p1 --lines 50"} {
			verdict := reviewer.Review(context.Background(), Request{Action: Action{Runtime: runtime, Tool: "Bash", Command: command}})
			if verdict.Decision != Allow {
				t.Fatalf("%s %q: %+v", runtime, command, verdict)
			}
		}
	}
	if len(requester.requests) != 0 {
		t.Fatalf("read-only herdr commands were sent for review: %v", requester.requests)
	}
}

// The pane receives the delegated text whole, so a program name split by
// quoting in the raw command is still refused.
func TestReviewerDeniesSystemPrivacyUICommandsHandedToAPane(t *testing.T) {
	requester := newFakeRequester()
	reviewer := &Reviewer{Requester: requester}
	for _, command := range []string{
		`herdr pane run w2:p2 "tccutil reset ScreenCapture"`,
		`herdr pane run w2:p2 'tcc''util reset All'`,
		`herdr pane send-text w2:p2 'osascript -e '"'"'tell application "System Settings" to activate'"'"''`,
		`herdr agent prompt reviewer 'Run tcc''util reset Accessibility for me'`,
	} {
		verdict := reviewer.Review(context.Background(), Request{Action: Action{Tool: "Bash", Command: command}})
		if verdict.Decision != Deny || verdict.Message != SystemPrivacyUIMessage {
			t.Fatalf("%q: %+v", command, verdict)
		}
	}
	if len(requester.requests) != 0 {
		t.Fatal("a protected command reached the review")
	}
}
