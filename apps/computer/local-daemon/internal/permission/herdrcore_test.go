package permission

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestShellClassifiesHerdrCoreCommands(t *testing.T) {
	workspace, _ := shellWorkspace(t)
	for _, test := range []struct {
		command string
		want    ShellDecision
	}{
		// Read-only info and query commands without review.
		{"hc --version", ShellAllow},
		{"hc -V", ShellAllow},
		{"hc --help", ShellAllow},
		{"hc --skill", ShellAllow},
		{"hc schema", ShellAllow},
		{"hc schema --json", ShellAllow},
		{"herdr-core --version", ShellAllow},
		{"herdr-core --skill", ShellAllow},
		{"herdr-core schema", ShellAllow},
		{"hc ls", ShellAllow},
		{"hc ls --all --label linger.room=r1", ShellAllow},
		{"hc --json ls", ShellAllow},
		{"hc get t7", ShellAllow},
		{"hc get vps/t7 --json", ShellAllow},
		{"hc read --lines 100 vps/t7 | tail -20", ShellAllow},
		{"hc wait t7 --timeout 60", ShellAllow},
		{"hc wait --children any", ShellAllow},
		{"hc events --terminal t7", ShellAllow},
		{"hc templates", ShellAllow},
		{"hc server status", ShellAllow},
		{"hc server status --json", ShellAllow},
		{"hc machine ls", ShellAllow},
		{"hc file read /srv/app/main.go --offset 1 --limit 50", ShellAllow},
		{"hc file read --on vps /srv/app/main.go", ShellAllow},
		{"herdr-core machine ls", ShellAllow},
		{"hc file", ShellAllow},
		{"hc machine --help", ShellAllow},
		{"hc server -h", ShellAllow},

		// Bare invocation, extra global flags, redirects, and mutating commands MUST be reviewed.
		{"hc", ShellReview},
		{"herdr-core", ShellReview},
		{"hc --version --skill", ShellReview},
		{"hc --session scratch ls", ShellReview},
		{"hc ls > notes/terminals.json", ShellReview},
		{"hc run --bg --name build cargo test", ShellReview},
		{"hc run --on vps --cwd /srv/app cargo build", ShellReview},
		{"hc send t7 'fix the bug'", ShellReview},
		{"hc keys t7 down enter", ShellReview},
		{"hc interrupt t7", ShellReview},
		{"hc put t7 screenshot.png", ShellReview},
		{"hc kill t7", ShellReview},
		{"hc rm t7", ShellReview},
		{"hc keep t7", ShellReview},
		{"hc keep t7 --off", ShellReview},
		{"hc label t7 linger.room=r1", ShellReview},
		{"hc exec --on vps git status", ShellReview},
		{"hc file write --on vps /srv/app/x.txt", ShellReview},
		{"hc file edit --on vps /srv/app/x.txt --old a --new b", ShellReview},
		{"hc machine add vps", ShellReview},
		{"hc machine rm vps", ShellReview},
		{"hc machine rename vps prod", ShellReview},
		{"hc machine login vps", ShellReview},
		{"hc machine update vps", ShellReview},
		{"hc server start", ShellReview},
		{"hc server stop", ShellReview},
		{"hc server restart", ShellReview},
		{"hc update", ShellReview},
		{"hc attach t7", ShellReview},
		{"hc connect --session work", ShellReview},
	} {
		if decision, _ := Shell(test.command, workspace, workspace, shellCommands); decision != test.want {
			t.Errorf("%q: decision %d, want %d", test.command, decision, test.want)
		}
	}
}

func TestHerdrCoreDelegationsExtractTargetsAndText(t *testing.T) {
	for _, test := range []struct {
		command string
		want    []Delegation
		unread  bool
	}{
		{
			command: `hc run --bg --on vps --name build --cwd /srv/app cargo test --release`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "vps/build", Text: "cargo test --release"}},
		},
		{
			command: `herdr-core run --on gpu "python train.py --epochs 10"`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "gpu", Text: "python train.py --epochs 10"}},
		},
		{
			command: `hc run --bg --name sh1`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "sh1", Text: "shell"}},
		},
		{
			command: `hc exec --on vps --cwd /srv/app --env FOO=bar -- git push origin main`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "vps", Text: "git push origin main"}},
		},
		{
			command: `hc send vps/t7 'deploy now' --force`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "vps/t7", Text: "deploy now"}},
		},
		{
			command: `hc keys vps/t7 down enter`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "vps/t7", Text: "down enter"}},
		},
		{
			command: `hc interrupt t7`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "t7", Text: "interrupt"}},
		},
		{
			command: `hc put vps/t7 /tmp/shot.png`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "vps/t7", Text: "put /tmp/shot.png"}},
		},
		{
			command: `hc kill vps/t7 && hc rm vps/t7`,
			want: []Delegation{
				{Kind: DelegationTerminalInput, Target: "vps/t7", Text: "kill"},
				{Kind: DelegationTerminalInput, Target: "vps/t7", Text: "rm"},
			},
		},
		{
			command: `hc keep t7 --off`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "t7", Text: "keep --off"}},
		},
		{
			command: `hc label t7 linger.room=r1 linger.origin=agent_delegate`,
			want:    []Delegation{{Kind: DelegationTerminalInput, Target: "t7", Text: "label linger.room=r1 linger.origin=agent_delegate"}},
		},
		{
			command: `hc file write --on vps /srv/app/config.toml`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "vps:/srv/app/config.toml", Text: "file write /srv/app/config.toml"}},
		},
		{
			command: `hc file edit --on vps /srv/app/config.toml --old 'debug = false' --new 'debug = true'`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "vps:/srv/app/config.toml", Text: "file edit /srv/app/config.toml --old debug = false --new debug = true"}},
		},
		{
			command: `hc machine add --via 'ssh -i key user@box' --name prod`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "prod", Text: "machine add --via ssh -i key user@box"}},
		},
		{
			command: `hc machine rm prod`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "prod", Text: "machine rm prod"}},
		},
		{
			command: `hc machine rename prod staging`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "prod", Text: "machine rename prod staging"}},
		},
		{
			command: `hc server stop`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "local", Text: "server stop"}},
		},
		{
			command: `hc server restart --fresh`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "local", Text: "server restart --fresh"}},
		},
		{
			command: `hc update --version 0.2.0`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "local", Text: "update --version 0.2.0"}},
		},
		// Full path binary still extracts delegations.
		{
			command: `/Users/cdd/.local/bin/hc exec 'rm -rf /tmp/x'`,
			want:    []Delegation{{Kind: DelegationShellCommand, Target: "local", Text: "rm -rf /tmp/x"}},
		},
		// Read-only commands extract nothing and do not trigger unread false positives.
		{command: `hc ls`, want: nil, unread: false},
		{command: `hc read t7 > ~/out.txt`, want: nil, unread: false},
		{command: `hc file read --on vps /srv/app/x.rs > ~/run.log`, want: nil, unread: false},
		{command: `hc server status >/dev/null`, want: nil, unread: false},
		{command: `echo "$HOME"`, want: nil, unread: false},
		// Unreadable shell syntax with mutating subcommands MUST set unread=true.
		{command: `hc send t7 "$(cat secret)"`, want: nil, unread: true},
		{command: `hc run --on vps "deploy $ENV"`, want: nil, unread: true},
		{command: `herdr-core exec "$(cat cmd)"`, want: nil, unread: true},
		{command: `hc 'run' --on vps "$(cat cmd)"`, want: nil, unread: true},
		{command: "hc \\\nexec \"$(cat cmd)\"", want: nil, unread: true},
		{command: `hc file  'edit' /etc/hosts --old "$A" --new "$B"`, want: nil, unread: true},
		{command: `hc machine  add "$HOST"`, want: nil, unread: true},
		{command: `hc server  stop && echo "$HOME"`, want: nil, unread: true},
		{command: `/Users/cdd/.local/bin/hc --json send t7 "$MSG"`, want: nil, unread: true},
	} {
		delegations, unread := HerdrCoreDelegations(test.command)
		if !reflect.DeepEqual(delegations, test.want) || unread != test.unread {
			t.Errorf("%q:\n  got  delegations=%+v unread=%v\n  want delegations=%+v unread=%v", test.command, delegations, unread, test.want, test.unread)
		}
	}
}

func TestReviewerReviewsHerdrCoreAndAllowsReadOnly(t *testing.T) {
	workspace, _ := shellWorkspace(t)

	// Read-only hc commands are allowed without reaching the requester.
	readRequester := newFakeRequester()
	readReviewer := &Reviewer{Requester: readRequester, Environment: Environment{Workspace: workspace}}
	for _, cmd := range []string{
		"hc ls",
		"hc get vps/t7 --json",
		"hc read --lines 80 vps/t7",
		"hc wait --children any",
		"hc templates",
		"hc server status",
		"hc machine ls",
		"hc file read --on vps /srv/app/main.go --offset 1 --limit 50",
		"herdr-core --version",
		"hc schema",
	} {
		verdict := readReviewer.Review(context.Background(), Request{Action: Action{Runtime: "claude", Tool: "Bash", Command: cmd}})
		if verdict.Decision != Allow {
			t.Fatalf("%q: decision=%+v, want Allow", cmd, verdict)
		}
	}
	if len(readRequester.requests) != 0 {
		t.Fatalf("read-only hc commands reached requester: %v", readRequester.requests)
	}

	// Mutating and unreadable hc commands attach structured Evidence.
	for _, tc := range []struct {
		name    string
		command string
		want    string
	}{
		{
			name:    "remote run with machine target",
			command: `hc run --on vps --name deploy "git push origin main"`,
			want:    `{"delegations":[{"kind":"shell_command","target":"vps/deploy","text":"git push origin main"}]}`,
		},
		{
			name:    "remote file edit with old and new text",
			command: `hc file edit --on vps /srv/app/app.env --old "DEBUG=0" --new "DEBUG=1"`,
			want:    `{"delegations":[{"kind":"shell_command","target":"vps:/srv/app/app.env","text":"file edit /srv/app/app.env --old DEBUG=0 --new DEBUG=1"}]}`,
		},
		{
			name:    "unreadable shell syntax attaches missing note",
			command: `hc send vps/t7 "Deploy $BRANCH"`,
			want:    `{"missing":["` + HerdrCoreUnreadMissing + `"]}`,
		},
		{
			name:    "read-only redirect outside parseShell has no missing note",
			command: `hc read vps/t7 > ~/screen.txt`,
			want:    `null`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requester := newFakeRequester()
			reviewer := &Reviewer{Requester: requester, Environment: Environment{Workspace: workspace}}
			verdict := review(reviewer, Request{Action: Action{Runtime: "claude", Tool: "Bash", Command: tc.command}})
			id := <-requester.sent
			encoded, _ := json.Marshal(requester.requests[id]["evidence"])
			var got, want any
			_ = json.Unmarshal(encoded, &got)
			if err := json.Unmarshal([]byte(tc.want), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("evidence=%s, want %s", encoded, tc.want)
			}
			requester.answer(t, id, `{"decision":"needs_approval","message":"card"}`)
			if res := <-verdict; res.Decision != NeedsApproval {
				t.Fatalf("verdict=%+v", res)
			}
		})
	}
}

func TestReviewerDeniesSystemPrivacyUIViaHerdrCore(t *testing.T) {
	requester := newFakeRequester()
	reviewer := &Reviewer{Requester: requester}
	for _, cmd := range []string{
		`hc run 'tcc''util reset ScreenCapture'`,
		`hc exec --on mac 'tcc''util reset All'`,
		`hc send t7 'osascript -e '"'"'tell application "System Settings" to activate'"'"''`,
		`hc machine add --name sneaky --via 'tcc''util reset Accessibility'`,
	} {
		verdict := reviewer.Review(context.Background(), Request{Action: Action{Tool: "Bash", Command: cmd}})
		if verdict.Decision != Deny || verdict.Message != SystemPrivacyUIMessage {
			t.Fatalf("%q: verdict=%+v", cmd, verdict)
		}
	}
	if len(requester.requests) != 0 {
		t.Fatal("protected privacy UI command reached review")
	}
}
