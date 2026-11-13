package proactive

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestRecordedTextAndSourceKey(t *testing.T) {
	due := time.Date(2026, 10, 21, 7, 0, 0, 0, time.UTC)
	if got := withDue(Candidate{Content: " Meet Alex ", DueAt: &due}); got != "Meet Alex (Oct 21 15:00)" {
		t.Fatalf("text=%q", got)
	}
	allDay := time.Date(2026, 10, 21, 15, 59, 59, 0, time.UTC)
	if got := withDue(Candidate{Content: "Submit the weekly report", DueAt: &allDay}); got != "Submit the weekly report (Oct 21)" {
		t.Fatalf("a day without a time must not show 23:59: %q", got)
	}
	if got := withDue(Candidate{Content: "Remind me to call Alex"}); got != "Remind me to call Alex" {
		t.Fatalf("content must be kept verbatim: %q", got)
	}
	long := strings.Repeat("あ", 3000)
	if got := withDue(Candidate{Content: long, DueAt: &due}); utf8.RuneCountInString(got) > 2000 ||
		!strings.HasPrefix(got, strings.Repeat("あ", maxRecordedRunes)) || !strings.HasSuffix(got, "… (Oct 21 15:00)") {
		t.Fatalf("a long event must be cut to fit the record, keeping its due time: %d runes", utf8.RuneCountInString(got))
	}
	day := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	if SourceKey("tracking_item", "Meet", day) != SourceKey("tracking_item", " Meet ", day) ||
		SourceKey("tracking_item", "Meet", day) == SourceKey("tracking_item", "Meet", day.AddDate(0, 0, 1)) ||
		SourceKey("tracking_item", "Meet", day) == SourceKey("pocket_note", "Meet", day) {
		t.Fatal("source keys must name the same thing for one day only")
	}
	if got := Day(time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)); !got.Equal(day) {
		t.Fatalf("Beijing day=%s", got)
	}
}

func TestJudgeRulesDecideOnlyByActiveRules(t *testing.T) {
	judge := Guideline{Version: 4, Rules: []Rule{
		{ID: "pr_a", Text: "client replies → remind directly", Status: RuleActive},
		{ID: "pr_b", Text: "vendor invoices → track for follow-up", Status: RuleShadow},
		{ID: "pr_c", Text: "news → stay silent", Status: RuleActive, Pinned: true, Source: RuleByHuman},
	}}.JudgeRules()
	if judge.Version != 4 || len(judge.Rules) != 2 || judge.Rules[0] != "client replies → remind directly" || judge.Rules[1] != "news → stay silent" ||
		len(judge.ShadowRules) != 1 || judge.ShadowRules[0] != (ShadowRule{ID: "pr_b", Text: "vendor invoices → track for follow-up"}) {
		t.Fatalf("judge rules=%+v", judge)
	}
	if empty := DefaultGuideline().JudgeRules(); empty.Rules == nil || empty.ShadowRules == nil {
		t.Fatal("a Human without rules must send empty lists, not null")
	}
}
