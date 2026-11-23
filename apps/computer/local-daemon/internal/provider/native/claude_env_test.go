package native

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"
)

func TestClaudeEnvironmentDefaultsAndPreservesCallerOverride(t *testing.T) {
	if got := ClaudeEnvironment(nil); got[claudeDisableNonessentialTrafficKey] != "1" {
		t.Fatalf("ClaudeEnvironment(nil) = %+v, want %s=1", got, claudeDisableNonessentialTrafficKey)
	}

	caller := map[string]string{"ANTHROPIC_BASE_URL": "http://127.0.0.1:8080/anthropic"}
	derived := ClaudeEnvironment(caller)
	if derived[claudeDisableNonessentialTrafficKey] != "1" {
		t.Fatalf("derived = %+v, want %s=1", derived, claudeDisableNonessentialTrafficKey)
	}
	if _, mutated := caller[claudeDisableNonessentialTrafficKey]; mutated {
		t.Fatal("ClaudeEnvironment mutated caller environment map")
	}

	explicit := map[string]string{claudeDisableNonessentialTrafficKey: "0"}
	if got := ClaudeEnvironment(explicit); got[claudeDisableNonessentialTrafficKey] != "0" {
		t.Fatalf("explicit override = %+v, want 0", got)
	}

	caseMatch := map[string]string{"claude_code_disable_nonessential_traffic": "0"}
	gotCase := ClaudeEnvironment(caseMatch)
	if gotCase["claude_code_disable_nonessential_traffic"] != "0" || len(gotCase) != 1 {
		t.Fatalf("case-insensitive override = %+v, want single preserved entry", gotCase)
	}
}

func TestClaudeInvocationDefaultsAndPreservesCallerOverride(t *testing.T) {
	base := []string{"HOME=/tmp/home"}
	inv := Invocation{Program: "claude", Env: base}
	derived := claudeInvocation(inv)
	if !slices.Contains(derived.Env, claudeDisableNonessentialTrafficKey+"=1") {
		t.Fatalf("derived.Env = %q, want %s=1", derived.Env, claudeDisableNonessentialTrafficKey)
	}
	if slices.Contains(base, claudeDisableNonessentialTrafficKey+"=1") {
		t.Fatal("claudeInvocation mutated caller Env slice")
	}

	override := Invocation{Program: "claude", Env: []string{claudeDisableNonessentialTrafficKey + "=0"}}
	gotOverride := claudeInvocation(override)
	if !slices.Equal(gotOverride.Env, []string{claudeDisableNonessentialTrafficKey + "=0"}) {
		t.Fatalf("override Env = %q", gotOverride.Env)
	}
}

func TestClaudeCatalogDisablesNonessentialTrafficAndPreservesOverride(t *testing.T) {
	if _, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
		"FIXTURE_WANT_NONESSENTIAL_DISABLED": "1",
	})); err != nil {
		t.Fatalf("default claude catalog failed: %v", err)
	}
	if _, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
		claudeDisableNonessentialTrafficKey:  "0",
		"FIXTURE_WANT_NONESSENTIAL_DISABLED": "0",
	})); err != nil {
		t.Fatalf("override claude catalog failed: %v", err)
	}
}

func TestClaudeRuntimeAndPrestartDisableNonessentialTraffic(t *testing.T) {
	result := `{"type":"result","subtype":"success","result":"ready","terminal_reason":"completed"}`

	// Active turn receives CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 without mutating Profile.Env.
	profile := claudeFramesProfile(t, "frames", []string{result}, map[string]string{
		"CLAUDE_FAKE_WANT_NONESSENTIAL_DISABLED": "1",
	})
	_, outcome := claudeFinish(t, claudeStart(t, profile, "hello", RunSpec{}), 10*time.Second)
	if outcome.Status != statusCompleted {
		t.Fatalf("active turn outcome = %+v, want completed", outcome)
	}
	if _, mutated := profile.Env[claudeDisableNonessentialTrafficKey]; mutated {
		t.Fatal("claudeRuntime.Start mutated Profile.Env")
	}

	// Explicit caller override is preserved on active turns.
	overrideProfile := claudeFramesProfile(t, "frames", []string{result}, map[string]string{
		claudeDisableNonessentialTrafficKey:      "0",
		"CLAUDE_FAKE_WANT_NONESSENTIAL_DISABLED": "0",
	})
	_, outcome = claudeFinish(t, claudeStart(t, overrideProfile, "hello", RunSpec{}), 10*time.Second)
	if outcome.Status != statusCompleted {
		t.Fatalf("override active turn outcome = %+v, want completed", outcome)
	}

	if runtime.GOOS == "windows" {
		return
	}
	// Parked pre-start resident process also receives the default and matches
	// shape when adopted by the subsequent turn.
	withResidentCap(t, claudeResidents, DefaultResidentCap)
	t.Cleanup(func() { _, _ = StopAllParkedResidents() })
	dir := t.TempDir()
	root := filepath.Join(dir, "sessions")
	env := map[string]string{
		"CLAUDE_FAKE_DIR":                        dir,
		"CLAUDE_FAKE_SESSION":                    claudeTestSession,
		claudeSessionRoot:                        root,
		"CLAUDE_FAKE_WANT_NONESSENTIAL_DISABLED": "1",
	}
	residentProfile := claudeFakeProfile(t, "resident", env)
	_, preOutcome := claudeFinish(t, claudeStart(t, residentProfile, "", RunSpec{
		PrepareOnly:     true,
		AssignSessionID: claudeTestSession,
	}), 15*time.Second)
	if preOutcome.Status != statusCompleted || !preOutcome.Parked {
		t.Fatalf("prestart outcome = %+v, want parked completion", preOutcome)
	}
	if _, mutated := residentProfile.Env[claudeDisableNonessentialTrafficKey]; mutated {
		t.Fatal("claudeRuntime.prestart mutated Profile.Env")
	}
	events, turnOutcome := claudeFinish(t, claudeStart(t, residentProfile, "hello", RunSpec{
		AssignSessionID:   claudeTestSession,
		ExposeTurnStarted: true,
	}), 15*time.Second)
	if turnOutcome.Status != statusCompleted {
		t.Fatalf("adopted turn outcome = %+v, want completed", turnOutcome)
	}
	reused := false
	for _, event := range events {
		if event.Kind == EventStatus && event.ProcessReused != nil && *event.ProcessReused {
			reused = true
		}
	}
	if !reused {
		t.Fatalf("expected prestart process with default Claude env to be adopted, events = %+v", events)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "pids")); err != nil || len(data) == 0 {
		t.Fatalf("expected resident pid record, err = %v", err)
	}
}
