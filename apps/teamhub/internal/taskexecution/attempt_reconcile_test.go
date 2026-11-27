package taskexecution

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

func TestInspectCurrentAttemptRunsClassifiesCurrentInputTerminals(t *testing.T) {
	tests := []struct {
		name             string
		observation      string
		allTerminal      bool
		allSucceeded     bool
		failed, canceled bool
	}{
		{
			name: "all succeeded",
			observation: `{
				"participant_runs":[
					{"actor_id":"actor_1","agent_management_id":"agent_1","agent_run_ref":"run_1"},
					{"actor_id":"actor_2","agent_management_id":"agent_2","agent_run_ref":"run_2"}
				],
				"participant_terminals":[
					{"agent_run_ref":"run_1","status":"succeeded"},
					{"agent_run_ref":"run_2","status":"succeeded"}
				]
			}`,
			allTerminal: true, allSucceeded: true,
		},
		{
			name: "one failed while another runs",
			observation: `{
				"participant_runs":[
					{"actor_id":"actor_1","agent_management_id":"agent_1","agent_run_ref":"run_1"},
					{"actor_id":"actor_2","agent_management_id":"agent_2","agent_run_ref":"run_2"}
				],
				"participant_terminals":[{"agent_run_ref":"run_1","status":"failed"}]
			}`,
			failed: true,
		},
		{
			name: "one canceled while another runs",
			observation: `{
				"participant_runs":[
					{"actor_id":"actor_1","agent_management_id":"agent_1","agent_run_ref":"run_1"},
					{"actor_id":"actor_2","agent_management_id":"agent_2","agent_run_ref":"run_2"}
				],
				"participant_terminals":[{"agent_run_ref":"run_2","status":"canceled"}]
			}`,
			canceled: true,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			input := store.TaskInputRevision{MessageEffectIds: []byte(`["effect_current"]`)}
			effects := []store.TaskEffect{{
				ID: "effect_current", Operation: "submit_agent_turn", Status: "succeeded",
				Observation: []byte(testCase.observation),
			}}
			result, err := inspectCurrentAttemptRuns(input, effects)
			if err != nil {
				t.Fatal(err)
			}
			if result.allTerminal != testCase.allTerminal || result.allSucceeded != testCase.allSucceeded ||
				result.failed != testCase.failed || result.canceled != testCase.canceled {
				t.Fatalf("classification=%+v", result)
			}
		})
	}
}

func TestInspectCurrentAttemptRunsFencesOldEffects(t *testing.T) {
	input := store.TaskInputRevision{MessageEffectIds: []byte(`["effect_current"]`)}
	effects := []store.TaskEffect{
		{
			ID: "effect_old", Operation: "submit_agent_turn", Status: "succeeded",
			Observation: []byte(`{
				"participant_runs":[{"actor_id":"actor_1","agent_management_id":"agent_1","agent_run_ref":"run_old"}],
				"participant_terminals":[{"agent_run_ref":"run_old","status":"failed"}]
			}`),
		},
		{ID: "effect_current", Operation: "submit_agent_turn", Status: "pending"},
	}
	result, err := inspectCurrentAttemptRuns(input, effects)
	if err != nil {
		t.Fatal(err)
	}
	if result.failed || result.canceled || result.allTerminal || result.allSucceeded {
		t.Fatalf("old effect escaped current InputRevision fence: %+v", result)
	}
}

func TestInspectCurrentAttemptRunsKeepsTheReportedRunAndError(t *testing.T) {
	input := store.TaskInputRevision{MessageEffectIds: []byte(`["effect_current"]`)}
	effects := []store.TaskEffect{{
		ID: "effect_current", Operation: "submit_agent_turn", Status: "succeeded",
		Observation: []byte(`{
			"participant_runs":[{"actor_id":"actor_1","agent_management_id":"agent_1","agent_run_ref":"run_1"}],
			"participant_terminals":[{"agent_run_ref":"run_1","status":"failed","terminal_message":"provider quota exceeded"}]
		}`),
	}}
	result, err := inspectCurrentAttemptRuns(input, effects)
	if err != nil {
		t.Fatal(err)
	}
	if !result.failed || result.failureMessage != "provider quota exceeded" || result.lastRun.AgentRunRef != "run_1" {
		t.Fatalf("classification=%+v", result)
	}
	effects[0].Status, effects[0].Observation = "failed", []byte(`{"failure_code":"CONTEXT_ACTIVATION_RUNTIME_FAILED","retryable":true}`)
	result, err = inspectCurrentAttemptRuns(input, effects)
	if err != nil || !result.failed || result.failureMessage != "the AlterEgo could not start: CONTEXT_ACTIVATION_RUNTIME_FAILED" {
		t.Fatalf("activation failure=%+v err=%v", result, err)
	}
}

func TestQuietTaskReportAsksForOneReminder(t *testing.T) {
	quiet, ordinary := taskDoneReminder("task_1", true), taskDoneReminder("task_1", false)
	if !strings.Contains(quiet, "never saw it start") || !strings.Contains(quiet, "one reminder") || strings.Contains(quiet, "message card") {
		t.Fatalf("quiet report=%q", quiet)
	}
	if !strings.Contains(ordinary, "teamhub message card") || strings.Contains(ordinary, "never saw it start") {
		t.Fatalf("ordinary report=%q", ordinary)
	}
}

func TestClassifyAttemptStopSuppressesMetaWakeForCanceledAndInterruptedRuns(t *testing.T) {
	tests := []struct {
		name        string
		timedOut    bool
		runs        currentAttemptRuns
		wantStopped bool
		want        attemptStopOutcome
	}{
		{
			name: "still running",
			runs: currentAttemptRuns{},
		},
		{
			name:        "attempt timeout notifies Meta",
			timedOut:    true,
			runs:        currentAttemptRuns{},
			wantStopped: true,
			want: attemptStopOutcome{
				status:         "failed",
				stopReason:     "attempt_timeout",
				failureMessage: "the Run did not finish within its time limit",
				notifyMeta:     true,
			},
		},
		{
			name:        "provider failure notifies Meta",
			runs:        currentAttemptRuns{failed: true, failureMessage: "provider quota exceeded"},
			wantStopped: true,
			want: attemptStopOutcome{
				status:         "failed",
				stopReason:     "agent_run_failed",
				failureMessage: "provider quota exceeded",
				notifyMeta:     true,
			},
		},
		{
			name:        "process_interrupted stays failed without waking Meta",
			runs:        currentAttemptRuns{failed: true, failureMessage: "process_interrupted"},
			wantStopped: true,
			want: attemptStopOutcome{
				status:         "failed",
				stopReason:     "agent_run_failed",
				failureMessage: "process_interrupted",
				notifyMeta:     false,
			},
		},
		{
			name:        "canceled Run moves Task to canceled without waking Meta",
			runs:        currentAttemptRuns{canceled: true},
			wantStopped: true,
			want: attemptStopOutcome{
				status:         "canceled",
				stopReason:     "agent_run_canceled",
				failureMessage: "the Run was canceled",
				notifyMeta:     false,
			},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			got, stopped := classifyAttemptStop(testCase.timedOut, testCase.runs)
			if stopped != testCase.wantStopped || got != testCase.want {
				t.Fatalf("classifyAttemptStop(%v, %+v) = (%+v, %v), want (%+v, %v)",
					testCase.timedOut, testCase.runs, got, stopped, testCase.want, testCase.wantStopped)
			}
		})
	}
}
