package integration_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func TestDelegatedTaskAcrossRunnerOperations(t *testing.T) {
	allowParallelIntegrationTest(t)
	for _, action := range []string{"resume", "human stop"} {
		t.Run(action, func(t *testing.T) {
			env, alice, issued, roomID := newAgentCLIIdentity(t)
			task := createDelegatedTask(t, env, issued, "operations", "Draft a report", "Draft a report.", roomID)
			worker := claimDelegatedTask(t, env, task.TaskID, "worker-operations")
			attemptID := worker.bundle.Execution.CurrentAttempt.ID
			service := agentruntimestate.New(env.pool)
			const epoch = "operations-epoch"
			startRuntimeEpoch(t, service, epoch)
			context, err := service.EnsureContext(t.Context(), agentruntimestate.EnsureContextInput{
				Ref: agentruntimestate.ContextRef{Kind: "alter_ego", AgentID: acmeOfficialAgentManagementID, TaskID: task.TaskID}, TargetResidency: "active",
			})
			if err != nil {
				t.Fatal(err)
			}
			key := context.Context.ContextKey
			submitted, err := service.SubmitTrustedTurn(t.Context(), agentruntimestate.SubmitTrustedTurnInput{
				ContextKey: key, Epoch: epoch, Inputs: []agentruntimestate.RuntimeInput{
					runtimeInput("input-operations", "trusted_turn", "meta:actor_acme_official:"+task.TaskID, "Draft a report."),
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			runID := submitted.RunID
			effectID := worker.startTurn(runID)
			claimed, err := service.ClaimLocalRun(t.Context(), agentruntimestate.ClaimLocalRunInput{ContextKey: key, Epoch: epoch, ClaimID: "claim-operations"})
			if err != nil || claimed.Run == nil || claimed.Run.RunID != runID || claimed.Run.AttemptCount != 1 {
				t.Fatalf("claim: %+v %v", claimed, err)
			}

			recordOperation := func(id string, usage json.RawMessage) {
				t.Helper()
				if err := service.RecordRunOperation(t.Context(), agentruntimestate.RecordRunOperationInput{
					ContextKey: key, Epoch: epoch, RunID: runID, OperationID: id, RuntimeType: "codex", Usage: usage,
				}); err != nil {
					t.Fatal(err)
				}
			}
			backgroundPath := "/v0/rooms/" + roomID + "/background-tasks"
			assertStillRunning := func() {
				t.Helper()
				status, _, body := env.request(alice, http.MethodGet, backgroundPath, nil, "")
				var list httpapi.RoomBackgroundTaskList
				if err := json.Unmarshal(body, &list); err != nil || status != http.StatusOK || len(list.Items) != 1 || list.Items[0].Id != task.TaskID {
					t.Fatalf("background list: %d %s", status, body)
				}
				assertDelegatedTaskState(t, env, task.TaskID, "running", "")
				if got := countRows(t, env, `SELECT count(*) FROM task_attempts WHERE task_id=$1 AND id=$2 AND status='running'`, task.TaskID, attemptID); got != 1 {
					t.Fatal("original Task attempt no longer running")
				}
				run, err := service.GetLocalRun(t.Context(), key, runID)
				if err != nil || run.Status != "running" || run.AttemptCount != 1 || len(run.Terminal) != 0 {
					t.Fatalf("yielded Local Run: %+v %v", run, err)
				}
				if got := countRows(t, env, `SELECT count(*) FROM task_meta_callback_messages WHERE task_id=$1`, task.TaskID); got != 0 {
					t.Fatalf("operation generated %d Meta messages", got)
				}
				if got := countRows(t, env, `SELECT count(*) FROM river_job WHERE kind='task_execution.participant_run_finished' AND args->>'task_id'=$1`, task.TaskID); got != 0 {
					t.Fatalf("operation generated %d participant completion jobs", got)
				}
			}

			// A yielded Operation reports its terminal usage while the Agent Service keeps the Run's claim.
			recordOperation("operation-first", json.RawMessage(`[{"provider":"openai","model":"fixture","input":10,"cache_read":0,"cache_write":0,"output":1}]`))
			assertStillRunning()
			if action == "human stop" {
				status, _, body := env.request(alice, http.MethodPost, backgroundPath+"/"+task.TaskID+"/cancel", nil, "")
				var canceled httpapi.RoomBackgroundTaskCancelResult
				if err := json.Unmarshal(body, &canceled); err != nil || status != http.StatusOK || canceled.Status != "canceled" || canceled.TaskId != task.TaskID {
					t.Fatalf("cancel: %d %s", status, body)
				}
				assertDelegatedTaskState(t, env, task.TaskID, "canceled", "stopped")
				if got := countRows(t, env, `SELECT count(*) FROM task_attempts WHERE task_id=$1 AND id=$2 AND status='stopped'`, task.TaskID, attemptID); got != 1 {
					t.Fatal("human stop did not stop the original attempt")
				}
				if got := countRows(t, env, `SELECT count(*) FROM task_effects WHERE task_id=$1 AND operation='cleanup_runtime' AND payload->>'agent_run_ref'=$2`, task.TaskID, runID); got != 1 {
					t.Fatalf("human stop queued %d cleanups for the yielded Run", got)
				}
				if reports := taskReports(t, env, task.TaskID); len(reports) != 0 {
					t.Fatalf("human stop produced agent reports: %q", reports)
				}
				return
			}

			recordOperation("operation-resumed", nil)
			assertStillRunning()
			operations, err := store.New(env.pool).ListAgentRuntimeNativeOperationIDs(t.Context(), runID)
			if err != nil || !slices.Equal(operations, []string{"operation-first", "operation-resumed"}) {
				t.Fatalf("native operations on Run %s: %v %v", runID, operations, err)
			}
			if _, err := service.FinishLocalRun(t.Context(), agentruntimestate.FinishLocalRunInput{
				ContextKey: key, Epoch: epoch, RunID: runID, Terminal: json.RawMessage(`{"type":"succeeded","finalResponse":"The report is ready."}`),
			}); err != nil {
				t.Fatal(err)
			}
			worker.endTurn(effectID, runID, "succeeded", "")
			worker.advance()
			assertDelegatedTaskState(t, env, task.TaskID, "idle", "run_succeeded")
			if got := countRows(t, env, `SELECT count(*) FROM task_attempts WHERE task_id=$1 AND id=$2 AND status='passed'`, task.TaskID, attemptID); got != 1 {
				t.Fatal("the original attempt did not pass")
			}
			if got := countRows(t, env, `SELECT count(*) FROM task_attempts WHERE task_id=$1`, task.TaskID); got != 1 {
				t.Fatalf("operations created %d Task attempts", got)
			}
			if reports := taskReports(t, env, task.TaskID); len(reports) != 2 || reports[1] != "The report is ready." {
				t.Fatalf("expected one idle notice and final reply: %q", reports)
			}
		})
	}
}
