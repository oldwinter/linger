package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

// A Task AnotherMe starts in a Run that a delivered proactive wake started is
// quiet: it keeps its origin link, so task check, send and stop still reach
// it, but the running-Task indicator leaves it out. A Task started by the Human or by a
// plain Routine they set up is ordinary.
func TestTaskStartedByProactiveWakeIsQuiet(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, pool := newConnectedAnotherMeEnv(t, nil)
	alice := env.login("alice", alicePassword)
	roomID := anotherMeRoomID(t, pool, "actor_acme_alice")
	var managementID string
	if err := pool.QueryRow(t.Context(), `SELECT agent_management_id FROM agent_registrations
		WHERE represented_human_actor_id='actor_acme_alice' AND agent_type='anotherme'`).Scan(&managementID); err != nil {
		t.Fatal(err)
	}
	ensured, err := agentruntimestate.New(pool).EnsureContext(t.Context(), agentruntimestate.EnsureContextInput{TargetResidency: "active",
		Ref: agentruntimestate.ContextRef{Kind: "meta", AgentID: managementID, RoomID: roomID},
	})
	if err != nil {
		t.Fatal(err)
	}
	// wakeRun delivers a wake, gives it this source and makes a running Run
	// whose initial input carries it, as an accepted Room Inbox notification does.
	sequence := int64(1000)
	wakeRun := func(runID, source string) string {
		t.Helper()
		sequence += 1000
		if err := proactive.New(pool, nil, nil).QueueWake(t.Context(), managementID, roomID, "[Proactive review] "+runID); err != nil {
			t.Fatal(err)
		}
		wakeID := pendingWakeID(t, pool, roomID)
		if wait, err := reminder.Deliver(t.Context(), pool, wakeID, time.Now().Add(reminder.Window+time.Minute), reminder.Window); err != nil || wait != 0 {
			t.Fatalf("wake not delivered: wait=%v err=%v", wait, err)
		}
		var wakeMessageID string
		if err := pool.QueryRow(t.Context(), `UPDATE proactive_pending_wakes SET source=$2 WHERE id=$1 RETURNING message_id`, wakeID, source).Scan(&wakeMessageID); err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(map[string]any{"invocationMessageIds": []string{wakeMessageID}})
		if _, err := pool.Exec(t.Context(), `INSERT INTO agent_local_runs(run_id,context_key,status,status_room_id,started_at) VALUES($1,$2,'running',$3,now())`,
			runID, ensured.Context.ContextKey, roomID); err != nil {
			t.Fatal(err)
		}
		inputID := runID + "-input"
		if _, err := pool.Exec(t.Context(), `INSERT INTO agent_runtime_inputs(context_key,input_id,input_sequence,payload,payload_hash,source_kind,source_inbox_id,status,local_run_id)
			VALUES($1,$2,$6,$3,decode(repeat('a',64),'hex'),'inbox',$4,'handled',$5)`,
			ensured.Context.ContextKey, inputID, payload, "room:"+roomID, runID, sequence); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO agent_local_run_inputs(run_id,context_key,input_id,relation,ordinal)
			VALUES($1,$2,$3,'initial',0)`, runID, ensured.Context.ContextKey, inputID); err != nil {
			t.Fatal(err)
		}
		return runID
	}
	issued, err := agentcredential.New(pool).IssueManaged(t.Context(), managementID, "quiet task")
	if err != nil {
		t.Fatal(err)
	}
	create := func(invocation, name string, headers http.Header) string {
		t.Helper()
		code, body := postDelegatedTask(t, env, issued, invocation, name, name+".", headers)
		var created delegatedTaskResponse
		if code != http.StatusOK || json.Unmarshal(body, &created) != nil || created.TaskID == "" {
			t.Fatalf("create %s=%d %s", name, code, body)
		}
		return created.TaskID
	}
	inRun := func(runID string) http.Header {
		headers := taskDelegationRoomContext(roomID)
		headers.Set("X-TeamHub-Run-Id", runID)
		return headers
	}
	quietTask := create("quiet-task", "Prepare the pitch deck", inRun(wakeRun("review-wake-run", "review")))
	// A Context runs one Run at a time.
	if _, err := pool.Exec(t.Context(), `UPDATE agent_local_runs SET status='succeeded', terminal='{"type":"succeeded"}', finished_at=now() WHERE run_id='review-wake-run'`); err != nil {
		t.Fatal(err)
	}
	// A plain Routine the Human set up is their own request.
	scheduledTask := create("scheduled-task", "Research the market", inRun(wakeRun("scheduled-wake-run", "scheduled")))
	ordinaryTask := create("ordinary-task", "Draft the reply", taskDelegationRoomContext(roomID))

	quiet := func(taskID string) bool {
		t.Helper()
		var value bool
		if err := pool.QueryRow(t.Context(), `SELECT quiet FROM work_items WHERE id=$1`, taskID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	if !quiet(quietTask) || quiet(scheduledTask) || quiet(ordinaryTask) {
		t.Fatalf("quiet: review Task=%v scheduled Task=%v ordinary Task=%v", quiet(quietTask), quiet(scheduledTask), quiet(ordinaryTask))
	}
	if titles := roomBackgroundTaskTitles(t, env, alice, roomID); len(titles) != 2 || titles[0] != "Research the market" || titles[1] != "Draft the reply" {
		t.Fatalf("indicator=%v", titles)
	}
	if got := countRows(t, env, `SELECT count(*) FROM work_item_room_links WHERE work_item_id=$1 AND room_id=$2 AND link_type='origin'`, quietTask, roomID); got != 1 {
		t.Fatalf("quiet Task origin links=%d", got)
	}
}
