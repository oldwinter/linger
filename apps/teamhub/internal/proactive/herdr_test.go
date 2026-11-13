package proactive

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

func blockedReport(seq int64) HerdrReport {
	return HerdrReport{
		ComputerID: "computer-1", Kind: HerdrAgentBlocked, PaneID: "w1:p1", StateChangeSeq: seq,
		Agent: "codex", Cwd: "/repo", Title: "fix tests", Tail: "Use option A or B?",
	}
}

func TestHerdrEventIsTheOwnersEventAdmittedByTheirComputer(t *testing.T) {
	event := HerdrEvent("tenant", "owner", blockedReport(5))
	if err := event.validate(); err != nil {
		t.Fatal(err)
	}
	if event.ComputerID != "computer-1" || event.Grant != nil || event.TenantID != "tenant" || event.OwnerActorID != "owner" ||
		event.Source != SourceHerdr || event.Kind != HerdrAgentBlocked || event.ExternalID != "computer-1/w1:p1" || event.State != "5" ||
		event.Urgent || event.Herdr == nil || event.Herdr.PaneID != "w1:p1" || event.Herdr.StateChangeSeq != 5 {
		t.Fatalf("event=%+v", event)
	}
	for _, fact := range []string{"What: A coding agent is waiting for an answer", "Agent: codex", "Directory: /repo", "Pane: w1:p1", "Last lines of the pane: Use option A or B?"} {
		if !strings.Contains(event.Summary, fact) {
			t.Fatalf("summary lacks %q: %s", fact, event.Summary)
		}
	}
	finished := blockedReport(6)
	finished.Kind, finished.Tail = HerdrAgentFinished, ""
	if summary := HerdrEvent("tenant", "owner", finished).Summary; !strings.HasPrefix(summary, "What: A coding agent finished its work") || strings.Contains(summary, "Last lines") {
		t.Fatalf("finished summary=%s", summary)
	}
	both := event
	both.Grant = &reminder.GrantReference{ID: "grant", Revision: 1}
	if err := both.validate(); !errors.Is(err, ErrInvalidEvent) {
		t.Fatal("an event with two authorities was accepted")
	}
}

// Each herdr pane state is judged once a day, like one state of a mail thread;
// the pane's next state is a new one.
func TestHerdrPaneStatesAreDedupedAndGatedLikeAppEvents(t *testing.T) {
	day := Day(time.Date(2026, 11, 13, 2, 0, 0, 0, time.UTC))
	key := func(event Event) string {
		return SourceKey("event", event.Source+"\x00"+event.ExternalID+"\x00"+event.State, day)
	}
	first, repeated, next := HerdrEvent("t", "o", blockedReport(5)), HerdrEvent("t", "o", blockedReport(5)), HerdrEvent("t", "o", blockedReport(6))
	if key(first) != key(repeated) || key(first) == key(next) {
		t.Fatal("a pane state must be one matter state")
	}
	other := blockedReport(5)
	other.ComputerID = "computer-2"
	if key(first) == key(HerdrEvent("t", "o", other)) {
		t.Fatal("the same pane ID on another Computer is another matter")
	}
	// Not urgent: at 01:00 it is only recorded, at 08:00 it may be told.
	if first.Urgent || !gated(time.Date(2026, 11, 13, 1, 0, 0, 0, time.Local), 0) || gated(time.Date(2026, 11, 13, 8, 0, 0, 0, time.Local), 0) {
		t.Fatal("herdr events must follow quiet hours")
	}
}

func TestBlockedHerdrWakeTellsAnotherMeToAskTheHuman(t *testing.T) {
	text := eventText("[Proactive event: decide yourself]", HerdrEvent("tenant", "owner", blockedReport(5)))
	if !strings.Contains(text, "source: herdr; kind: agent_blocked; state: 5") ||
		!strings.Contains(text, "teamhub computer herdr ask --pane w1:p1 --state 5 ") || !strings.Contains(text, "never type into the pane") ||
		strings.Index(text, "</event>") > strings.Index(text, "teamhub computer herdr ask") {
		t.Fatalf("wake text=%q", text)
	}
	finished := blockedReport(6)
	finished.Kind = HerdrAgentFinished
	if text := eventText("[Proactive event: decide yourself]", HerdrEvent("tenant", "owner", finished)); strings.Contains(text, "herdr ask") {
		t.Fatalf("a finished agent has nothing to answer: %q", text)
	}
}

func TestHerdrReportNeedsAKnownKindAndPane(t *testing.T) {
	service := New(nil, nil, nil)
	for _, broken := range []func(*HerdrReport){
		func(r *HerdrReport) { r.Kind = "agent_idle" },
		func(r *HerdrReport) { r.PaneID = " " },
		func(r *HerdrReport) { r.StateChangeSeq = -1 },
	} {
		report := blockedReport(5)
		broken(&report)
		if err := service.EnqueueHerdrEvent(t.Context(), report); !errors.Is(err, ErrInvalidEvent) {
			t.Fatalf("report %+v: %v", report, err)
		}
	}
}
