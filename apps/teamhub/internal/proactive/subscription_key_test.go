package proactive

import (
	"errors"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

func TestNormalizeMailSubscriptionKey(t *testing.T) {
	// Separate account + thread ID and embedded account:thread ID normalize identically.
	a, err := NormalizeSubscriptionKey("gmail", "  External_Connection_ABC ", "  18F3aBcDeF  ")
	if err != nil {
		t.Fatalf("normalize gmail: %v", err)
	}
	b, err := NormalizeSubscriptionKey("mail", "", "external_connection_abc:18F3aBcDeF")
	if err != nil {
		t.Fatalf("normalize mail combined: %v", err)
	}
	c, err := NormalizeSubscriptionKey("outlook", "EXTERNAL_CONNECTION_ABC", "external_connection_abc:18F3aBcDeF")
	if err != nil {
		t.Fatalf("normalize outlook duplicate prefix: %v", err)
	}
	if a.SourceType != SubscriptionSourceMail || a.NormalizedKey != "external_connection_abc:18F3aBcDeF" {
		t.Fatalf("unexpected mail key: %+v", a)
	}
	if a.NormalizedKey != b.NormalizedKey || b.NormalizedKey != c.NormalizedKey {
		t.Fatalf("mail keys diverged: %+v vs %+v vs %+v", a, b, c)
	}

	// Base64 Outlook conversationId with '/', '+', '=' stays intact and case-sensitive.
	outlookA, err := NormalizeSubscriptionKey("outlook", "Conn_1", "AAQkAGM2/abc+123=")
	if err != nil {
		t.Fatalf("normalize outlook base64: %v", err)
	}
	outlookB, err := NormalizeSubscriptionKey("outlook", "conn_1", "aaqkagm2/abc+123=")
	if err != nil {
		t.Fatalf("normalize outlook lower: %v", err)
	}
	if outlookA.NormalizedKey != "conn_1:AAQkAGM2/abc+123=" || outlookA.NormalizedKey == outlookB.NormalizedKey {
		t.Fatalf("thread ID case must be preserved: %q vs %q", outlookA.NormalizedKey, outlookB.NormalizedKey)
	}

	// Feishu mail normalizes to mail.
	feishu, err := NormalizeSubscriptionKey("feishu_mail", "conn_feishu", "ft_42")
	if err != nil || feishu.SourceType != SubscriptionSourceMail || feishu.NormalizedKey != "conn_feishu:ft_42" {
		t.Fatalf("feishu=%+v err=%v", feishu, err)
	}

	// Malformed mail keys are rejected at the boundary.
	for _, tc := range []struct {
		account, externalID string
	}{
		{"", "thread_without_account"},
		{"", ":thread_1"},
		{"", "acct_1:"},
		{"acct_1", ""},
		{"acct/1", "thread_1"},
		{"acct:1", "thread_1"},
		{"acct 1", "thread_1"},
		{"acct_1", "thread with spaces"},
		{"acct_1", "thread\nnewline"},
	} {
		if _, err := NormalizeSubscriptionKey("gmail", tc.account, tc.externalID); !errors.Is(err, ErrInvalidSubscriptionKey) {
			t.Errorf("mail (%q, %q) expected ErrInvalidSubscriptionKey, got %v", tc.account, tc.externalID, err)
		}
	}
}

func TestNormalizeHerdrAndHerdrCoreSubscriptionKey(t *testing.T) {
	// Legacy herdr: distinct stateChangeSeq values map to the same computer/pane key.
	h1, err := NormalizeSubscriptionKey(SourceHerdr, "", "computer-1/w1:p1/5")
	if err != nil {
		t.Fatalf("herdr seq 5: %v", err)
	}
	h2, err := NormalizeSubscriptionKey(SourceHerdr, "", "computer-1/w1:p1/14")
	if err != nil {
		t.Fatalf("herdr seq 14: %v", err)
	}
	h3, err := NormalizeSubscriptionKey(SourceHerdr, "computer-1", "w1:p1")
	if err != nil {
		t.Fatalf("herdr split: %v", err)
	}
	evKey, ok, err := SubscriptionKeyFromEvent(HerdrEvent("t", "o", HerdrReport{
		ComputerID: "computer-1", Kind: HerdrAgentBlocked, PaneID: "w1:p1", StateChangeSeq: 99,
	}))
	if err != nil || !ok {
		t.Fatalf("herdr event key: ok=%v err=%v", ok, err)
	}
	for _, got := range []SubscriptionKey{h1, h2, h3, evKey} {
		if got.SourceType != SubscriptionSourceHerdr || got.NormalizedKey != "computer-1/w1:p1" {
			t.Fatalf("unexpected legacy herdr key: %+v", got)
		}
	}

	// herdr-core: distinct (turn, statusMs) values map to the same computer/address key.
	hcRemote1, err := NormalizeSubscriptionKey(SourceHerdrCore, "", "computer-1/vps/t7/4/1732670400000")
	if err != nil {
		t.Fatalf("herdr_core remote 1: %v", err)
	}
	hcRemote2, err := NormalizeSubscriptionKey("herdr-core", "", "computer-1/vps/t7/5/1732670500000")
	if err != nil {
		t.Fatalf("herdr_core remote 2: %v", err)
	}
	hcRemote3, err := NormalizeSubscriptionKey(SourceHerdrCore, "computer-1", "vps/t7")
	if err != nil {
		t.Fatalf("herdr_core split: %v", err)
	}
	hcEvKey, ok, err := SubscriptionKeyFromEvent(HerdrCoreEvent("t", "o", HerdrCoreReport{
		ComputerID: "computer-1", Kind: HerdrCoreAgentBlocked, Address: "vps/t7", Machine: "vps", Turn: 8, StatusMs: 9999,
	}))
	if err != nil || !ok {
		t.Fatalf("herdr_core event key: ok=%v err=%v", ok, err)
	}
	for _, got := range []SubscriptionKey{hcRemote1, hcRemote2, hcRemote3, hcEvKey} {
		if got.SourceType != SubscriptionSourceHerdr || got.NormalizedKey != "computer-1/vps/t7" {
			t.Fatalf("unexpected herdr_core remote key: %+v", got)
		}
	}

	hcLocal, err := NormalizeSubscriptionKey(SourceHerdrCore, "", "computer-1/t7/2/2000")
	if err != nil || hcLocal.NormalizedKey != "computer-1/t7" {
		t.Fatalf("herdr_core local key=%+v err=%v", hcLocal, err)
	}

	// Malformed herdr keys are rejected.
	for _, tc := range []struct {
		source, account, externalID string
	}{
		{SourceHerdr, "", "only_one_segment"},
		{SourceHerdr, "", "computer-1//5"},
		{SourceHerdr, "", "computer-1/../5"},
		{SourceHerdr, "computer-2", "computer-1/w1:p1/5"},
		{SourceHerdrCore, "", "computer-1/vps/../t7/1/2"},
		{SourceHerdrCore, "", "computer-1/bad space/1/2"},
		{SourceHerdrCore, "", "/vps/t7/1/2"},
	} {
		if _, err := NormalizeSubscriptionKey(tc.source, tc.account, tc.externalID); !errors.Is(err, ErrInvalidSubscriptionKey) {
			t.Errorf("herdr (%q, %q, %q) expected ErrInvalidSubscriptionKey, got %v", tc.source, tc.account, tc.externalID, err)
		}
	}
}

func TestNormalizeGitHubSubscriptionKey(t *testing.T) {
	forms := []string{
		"OldWinter/Linger#6",
		"  oldwinter/linger#0006  ",
		"https://github.com/OldWinter/Linger/issues/6",
		"https://github.com/OldWinter/Linger/issues/6#issuecomment-12345",
		"https://www.github.com/oldwinter/linger/pull/6/files?w=1",
		"http://github.com/oldwinter/linger/pulls/06/",
		"github.com/OldWinter/Linger/issues/6",
		"OldWinter/Linger/pull/6",
	}
	for _, raw := range forms {
		got, err := NormalizeSubscriptionKey(SourceGitHub, "", raw)
		if err != nil {
			t.Fatalf("NormalizeSubscriptionKey(%q) err=%v", raw, err)
		}
		if got.SourceType != SubscriptionSourceGitHub || got.NormalizedKey != "oldwinter/linger#6" {
			t.Fatalf("NormalizeSubscriptionKey(%q) = %+v, want oldwinter/linger#6", raw, got)
		}
	}

	ghEv, err := GitHubEvent(GitHubEventInput{
		Grant:        &reminder.GrantReference{ID: "g1", Revision: 1, ConnectionID: "conn_gh"},
		TenantID:     "t",
		OwnerActorID: "o",
		Owner:        "OldWinter",
		Repo:         "Linger",
		Number:       6,
		Summary:      "Follow up comment",
		Actor:        &EventActor{Kind: EventActorHuman, Handle: "alice"},
	})
	if err != nil {
		t.Fatalf("GitHubEvent: %v", err)
	}
	key, ok, err := SubscriptionKeyFromEvent(ghEv)
	if err != nil || !ok || key.NormalizedKey != "oldwinter/linger#6" {
		t.Fatalf("SubscriptionKeyFromEvent(ghEv) = %+v ok=%v err=%v", key, ok, err)
	}

	for _, bad := range []string{
		"",
		"oldwinter/linger",
		"oldwinter/linger#0",
		"oldwinter/linger#-5",
		"oldwinter/linger#abc",
		"oldwinter/linger#6/extra",
		"/linger#6",
		"oldwinter/#6",
		"-bad/linger#6",
		"oldwinter/..#6",
		"a/b/c#6",
		"https://evil.example/oldwinter/linger/issues/6",
		"https://github.com/oldwinter/linger/discussions/6",
		"https://github.com/oldwinter/linger/issues/6/unexpected",
	} {
		if _, err := NormalizeSubscriptionKey(SourceGitHub, "", bad); !errors.Is(err, ErrInvalidSubscriptionKey) {
			t.Errorf("github %q expected ErrInvalidSubscriptionKey, got %v", bad, err)
		}
	}
}

func TestClassifyEventActorConservativeHumanOnlyPolicy(t *testing.T) {
	cases := []struct {
		name      string
		event     Event
		wantKind  EventActorKind
		wantHuman bool
	}{
		{
			name: "verified human mail via listener",
			event: func() Event {
				e, _ := EventFromListener(reminder.ListenerEvent{
					Source: reminder.ListenerGmail, MessageID: "m1", ThreadID: "t1",
					From: "Lisa Chen <lisa@partner.example>", Subject: "Updated terms", Snippet: "Please take a look",
				})
				return e
			}(),
			wantKind: EventActorHuman, wantHuman: true,
		},
		{
			name: "no-reply mail is automated",
			event: func() Event {
				e, _ := EventFromListener(reminder.ListenerEvent{
					Source: reminder.ListenerGmail, MessageID: "m2", ThreadID: "t1",
					From: "GitHub <no-reply+alerts@github.com>", Subject: "Alert", Snippet: "Automated notice",
				})
				return e
			}(),
			wantKind: EventActorAutomated, wantHuman: false,
		},
		{
			name: "RFC 3834 Auto-Submitted mail is automated even with human address",
			event: func() Event {
				e, _ := EventFromListener(reminder.ListenerEvent{
					Source: reminder.ListenerGmail, MessageID: "m3", ThreadID: "t1",
					From: "Lisa <lisa@partner.example>", Subject: "Out of office", Snippet: "OOO", AutoSubmitted: true,
				})
				return e
			}(),
			wantKind: EventActorAutomated, wantHuman: false,
		},
		{
			name: "mail missing From defaults conservatively to unknown non-human",
			event: func() Event {
				e, _ := EventFromListener(reminder.ListenerEvent{
					Source: reminder.ListenerGmail, MessageID: "m4", ThreadID: "t1",
					Subject: "No sender", Snippet: "Body",
				})
				return e
			}(),
			wantKind: EventActorUnknown, wantHuman: false,
		},
		{
			name: "GitHub human issue comment",
			event: Event{
				Source: SourceGitHub, ExternalID: "oldwinter/linger#6", Kind: "issue_comment",
				Actor: &EventActor{Kind: EventActorHuman, Handle: "oldwinter"},
			},
			wantKind: EventActorHuman, wantHuman: true,
		},
		{
			name: "GitHub [bot] handle is always bot even if Kind mislabeled human",
			event: Event{
				Source: SourceGitHub, ExternalID: "oldwinter/linger#6", Kind: "issue_comment",
				Actor: &EventActor{Kind: EventActorHuman, Handle: "dependabot[bot]"},
			},
			wantKind: EventActorBot, wantHuman: false,
		},
		{
			name: "GitHub CI check_run is always CI even with human actor",
			event: Event{
				Source: SourceGitHub, ExternalID: "oldwinter/linger#6", Kind: "check_run",
				Actor: &EventActor{Kind: EventActorHuman, Handle: "oldwinter"},
			},
			wantKind: EventActorCI, wantHuman: false,
		},
		{
			name: "GitHub missing actor defaults to unknown non-human",
			event: Event{
				Source: SourceGitHub, ExternalID: "oldwinter/linger#6", Kind: "issue_comment",
			},
			wantKind: EventActorUnknown, wantHuman: false,
		},
		{
			name:      "herdr machine transition is system",
			event:     HerdrEvent("t", "o", HerdrReport{ComputerID: "c1", Kind: HerdrAgentFinished, PaneID: "w1:p1", StateChangeSeq: 3}),
			wantKind:  EventActorSystem,
			wantHuman: false,
		},
		{
			name:      "herdr_core machine transition is system",
			event:     HerdrCoreEvent("t", "o", HerdrCoreReport{ComputerID: "c1", Kind: HerdrCoreAgentBlocked, Address: "vps/t7", Turn: 2, StatusMs: 100}),
			wantKind:  EventActorSystem,
			wantHuman: false,
		},
		{
			name: "herdr explicit human input event is human",
			event: Event{
				Source: SourceHerdr, ComputerID: "c1", ExternalID: "c1/w1:p1", Kind: "human_message",
				Actor: &EventActor{Kind: EventActorHuman, DisplayName: "Alice"},
			},
			wantKind: EventActorHuman, wantHuman: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyEventActor(tc.event); got != tc.wantKind {
				t.Fatalf("ClassifyEventActor = %q, want %q", got, tc.wantKind)
			}
			if got := IsHumanAuthoredEvent(tc.event); got != tc.wantHuman {
				t.Fatalf("IsHumanAuthoredEvent = %v, want %v", got, tc.wantHuman)
			}
		})
	}
}
