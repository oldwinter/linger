package proactive

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

func blockedHerdrCoreReport(turn, statusMs int64) HerdrCoreReport {
	return HerdrCoreReport{
		ComputerID: "computer-1",
		Kind:       HerdrCoreAgentBlocked,
		Address:    "vps/t7",
		Machine:    "vps",
		Turn:       turn,
		StatusMs:   statusMs,
		Status:     &HerdrCoreStatus{State: "blocked", Kind: "permission", App: "codex", Msg: "Apply migration?"},
		Name:       "deploy",
		Cwd:        "/srv/app/api",
		Title:      "deploy migration",
		Template:   "codex",
		Parent:     "t1",
		Labels: map[string]string{
			HerdrCoreLabelRoom:     "room-1",
			HerdrCoreLabelWorkItem: "wi-42",
		},
		Tail: "Apply migration? [y/N]",
	}
}

func TestHerdrCoreEventCarriesStructuredStateAndWakePrompt(t *testing.T) {
	event := HerdrCoreEvent("tenant", "owner", blockedHerdrCoreReport(4, 1732670400000))
	if err := event.validate(); err != nil {
		t.Fatal(err)
	}
	if event.ComputerID != "computer-1" || event.Grant != nil || event.Source != SourceHerdrCore ||
		event.Kind != HerdrCoreAgentBlocked || event.ExternalID != "computer-1/vps/t7/4/1732670400000" ||
		event.State != "4:1732670400000" || event.HerdrCore == nil ||
		event.HerdrCore.Address != "vps/t7" || event.HerdrCore.Machine != "vps" ||
		event.HerdrCore.Turn != 4 || event.HerdrCore.StatusMs != 1732670400000 ||
		event.HerdrCore.App != "codex" || event.HerdrCore.Cwd != "/srv/app/api" ||
		event.HerdrCore.BlockKind != "permission" || event.HerdrCore.BlockReason != "Apply migration?" {
		t.Fatalf("event=%+v", event)
	}
	for _, want := range []string{
		"What: A coding agent is waiting for an answer",
		"Machine: vps",
		"Terminal: vps/t7",
		"App: codex",
		"Directory: /srv/app/api",
		"Status: blocked",
		"Block kind: permission",
		"Block reason: Apply migration?",
		"Labels: linger.room=room-1, linger.work_item=wi-42",
		"Last lines of the terminal: Apply migration? [y/N]",
	} {
		if !strings.Contains(event.Summary, want) {
			t.Fatalf("summary lacks %q: %s", want, event.Summary)
		}
	}

	text := eventText("[Proactive event: decide yourself]", event, "", receivedAt)
	if !strings.Contains(text, "teamhub computer hc ask --address vps/t7 --turn 4 --status-ms 1732670400000 ") ||
		!strings.Contains(text, "herdr_ask_gated") ||
		!strings.Contains(text, "Block reason") ||
		!strings.Contains(text, "Block reason: Apply migration?") ||
		strings.Index(text, "Block reason: Apply migration?") > strings.Index(text, "</event>") ||
		strings.Index(text, "</event>") > strings.Index(text, "teamhub computer hc ask") {
		t.Fatalf("wake text=%q", text)
	}

	errReport := blockedHerdrCoreReport(5, 1732670500000)
	errReport.Kind = HerdrCoreAgentError
	errReport.Status = &HerdrCoreStatus{State: "error", App: "codex", Msg: "API timeout"}
	errEvent := HerdrCoreEvent("tenant", "owner", errReport)
	if !strings.Contains(errEvent.Summary, "What: A coding agent reported an error") ||
		!strings.Contains(errEvent.Summary, "Status: error: API timeout") ||
		strings.Contains(errEvent.Summary, "Block reason:") ||
		strings.Contains(errEvent.Summary, "Block kind:") ||
		errEvent.HerdrCore.BlockReason != "" || errEvent.HerdrCore.BlockKind != "" {
		t.Fatalf("error summary=%s ref=%+v", errEvent.Summary, errEvent.HerdrCore)
	}
	if errText := eventText("[Proactive event]", errEvent, "", receivedAt); strings.Contains(errText, "hc ask") {
		t.Fatalf("error event should not instruct hc ask: %q", errText)
	}

	both := event
	both.Grant = &reminder.GrantReference{ID: "grant", Revision: 1}
	if err := both.validate(); !errors.Is(err, ErrInvalidEvent) {
		t.Fatal("event with two authorities should be rejected")
	}
}

func TestHerdrCoreBlockedReasonAndTailFallback(t *testing.T) {
	// Structured block reason reaches Another Me even when terminal tail is absent.
	reasonOnly := HerdrCoreReport{
		ComputerID: "computer-1",
		Kind:       HerdrCoreAgentBlocked,
		Address:    "t7",
		Turn:       2,
		StatusMs:   2000,
		Status:     &HerdrCoreStatus{State: "blocked", Kind: "question", App: "claude", Msg: "Keep existing config or overwrite?"},
	}
	reasonEvent := HerdrCoreEvent("tenant", "owner", reasonOnly)
	if !strings.Contains(reasonEvent.Summary, "Block kind: question") ||
		!strings.Contains(reasonEvent.Summary, "Block reason: Keep existing config or overwrite?") ||
		strings.Contains(reasonEvent.Summary, "Last lines of the terminal:") ||
		reasonEvent.HerdrCore.BlockKind != "question" ||
		reasonEvent.HerdrCore.BlockReason != "Keep existing config or overwrite?" {
		t.Fatalf("reason-only event=%+v summary=%s", reasonEvent.HerdrCore, reasonEvent.Summary)
	}

	// Omitted/empty status.msg and status.kind fall back cleanly to terminal tail.
	tailOnly := HerdrCoreReport{
		ComputerID: "computer-1",
		Kind:       HerdrCoreAgentBlocked,
		Address:    "t8",
		Turn:       3,
		StatusMs:   3000,
		Status:     &HerdrCoreStatus{State: "blocked", App: "claude", Msg: "   "},
		Tail:       "Overwrite config? [y/N]",
	}
	tailEvent := HerdrCoreEvent("tenant", "owner", tailOnly)
	if strings.Contains(tailEvent.Summary, "Block kind:") ||
		strings.Contains(tailEvent.Summary, "Block reason:") ||
		!strings.Contains(tailEvent.Summary, "Status: blocked") ||
		!strings.Contains(tailEvent.Summary, "Last lines of the terminal: Overwrite config? [y/N]") ||
		tailEvent.HerdrCore.BlockKind != "" ||
		tailEvent.HerdrCore.BlockReason != "" {
		t.Fatalf("tail-fallback event=%+v summary=%s", tailEvent.HerdrCore, tailEvent.Summary)
	}

	// Nil status still falls back cleanly to terminal tail.
	nilStatus := HerdrCoreReport{
		ComputerID: "computer-1",
		Kind:       HerdrCoreAgentBlocked,
		Address:    "t9",
		Turn:       4,
		StatusMs:   4000,
		Tail:       "Approve command? [y/N]",
	}
	nilEvent := HerdrCoreEvent("tenant", "owner", nilStatus)
	if strings.Contains(nilEvent.Summary, "Block kind:") ||
		strings.Contains(nilEvent.Summary, "Block reason:") ||
		!strings.Contains(nilEvent.Summary, "Last lines of the terminal: Approve command? [y/N]") {
		t.Fatalf("nil-status event summary=%s", nilEvent.Summary)
	}
}

func TestHerdrCoreDeduplicationUsesAddressTurnAndStatusMs(t *testing.T) {
	day := Day(time.Date(2026, 11, 27, 2, 0, 0, 0, time.UTC))
	key := func(event Event) string {
		return SourceKey("event", event.Source+"\x00"+event.ExternalID+"\x00"+event.State, day)
	}
	first := HerdrCoreEvent("t", "o", blockedHerdrCoreReport(4, 1000))
	same := HerdrCoreEvent("t", "o", blockedHerdrCoreReport(4, 1000))
	nextStatus := HerdrCoreEvent("t", "o", blockedHerdrCoreReport(4, 2000))
	nextTurn := HerdrCoreEvent("t", "o", blockedHerdrCoreReport(5, 1000))

	if key(first) != key(same) {
		t.Fatal("identical (address, turn, status_ms) must deduplicate")
	}
	if key(first) == key(nextStatus) || key(first) == key(nextTurn) {
		t.Fatal("different turn or status_ms must be distinct states")
	}
}

func TestHerdrCoreMyRulesConditionMatching(t *testing.T) {
	ref := HerdrCoreTerminalRef{
		Address:  "vps/t7",
		Machine:  "vps-prod-1",
		Turn:     4,
		StatusMs: 1000,
		App:      "codex",
		Cwd:      "/srv/app/api",
		Labels: map[string]string{
			HerdrCoreLabelRoom:     "room-1",
			HerdrCoreLabelWorkItem: "wi-42",
		},
	}

	if !MatchHerdrCoreCondition(&HerdrCoreRuleCondition{
		Machine: "vps-*",
		Cwd:     "/srv/app",
		App:     "Codex",
		Labels: map[string]string{
			HerdrCoreLabelRoom:     "room-1",
			HerdrCoreLabelWorkItem: "*",
		},
	}, ref) {
		t.Fatal("expected matching herdr_core rule condition")
	}

	for name, cond := range map[string]*HerdrCoreRuleCondition{
		"wrong machine":      {Machine: "local"},
		"sibling cwd prefix": {Cwd: "/srv/ap"},
		"wrong app":          {App: "claude"},
		"missing label":      {Labels: map[string]string{"herdr.space": "ops"}},
		"mismatched label":   {Labels: map[string]string{HerdrCoreLabelRoom: "room-2"}},
	} {
		if MatchHerdrCoreCondition(cond, ref) {
			t.Errorf("%s: expected non-match", name)
		}
	}

	localRef := ref
	localRef.Machine = ""
	if !MatchHerdrCoreCondition(&HerdrCoreRuleCondition{Machine: "local"}, localRef) {
		t.Fatal("expected local machine condition to match empty machine name")
	}

	guideline := Guideline{
		Version: 3,
		Rules: []Rule{
			{ID: "pr_1", Text: "Always notify on urgent prod work", Status: RuleActive},
			{
				ID:     "pr_2",
				Text:   "Always notify when codex on vps-prod-1 is blocked",
				Status: RuleActive,
				HerdrCore: &HerdrCoreRuleCondition{
					Machine: "vps-*",
					Cwd:     "/srv/app",
					App:     "codex",
					Labels:  map[string]string{HerdrCoreLabelRoom: "room-1"},
				},
			},
			{
				ID:        "pr_3",
				Text:      "Stay silent on local claude terminals",
				Status:    RuleActive,
				HerdrCore: &HerdrCoreRuleCondition{Machine: "local", App: "claude"},
			},
		},
	}

	matchingEvent := HerdrCoreEvent("tenant", "owner", HerdrCoreReport{
		ComputerID: "computer-1",
		Kind:       HerdrCoreAgentBlocked,
		Address:    "vps-prod-1/t7",
		Machine:    "vps-prod-1",
		Turn:       4,
		StatusMs:   1000,
		Status:     &HerdrCoreStatus{State: "blocked", App: "codex"},
		Cwd:        "/srv/app/api",
		Labels:     map[string]string{HerdrCoreLabelRoom: "room-1"},
	})
	judged := guideline.JudgeRulesForEvent(matchingEvent)
	if len(judged.Rules) != 2 || judged.Rules[0] != "Always notify on urgent prod work" ||
		judged.Rules[1] != "Always notify when codex on vps-prod-1 is blocked" {
		t.Fatalf("matched rules=%v", judged.Rules)
	}

	nonHerdrCore := HerdrEvent("tenant", "owner", blockedReport(1))
	judgedLegacy := guideline.JudgeRulesForEvent(nonHerdrCore)
	if len(judgedLegacy.Rules) != 1 || judgedLegacy.Rules[0] != "Always notify on urgent prod work" {
		t.Fatalf("legacy event should ignore herdr_core-scoped rules, got=%v", judgedLegacy.Rules)
	}
}

func TestHerdrCoreReportValidation(t *testing.T) {
	service := New(nil, nil, nil)
	for _, mutate := range []func(*HerdrCoreReport){
		func(r *HerdrCoreReport) { r.Kind = "unknown_kind" },
		func(r *HerdrCoreReport) { r.Address = "   " },
		func(r *HerdrCoreReport) { r.Turn = -1 },
		func(r *HerdrCoreReport) { r.StatusMs = -1 },
	} {
		report := blockedHerdrCoreReport(1, 100)
		mutate(&report)
		if err := service.EnqueueHerdrCoreEvent(t.Context(), report); !errors.Is(err, ErrInvalidEvent) {
			t.Fatalf("report %+v: err=%v", report, err)
		}
	}
}
