package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
)

type delegatedTaskResponse struct {
	Accepted         bool   `json:"accepted"`
	TaskID           string `json:"task_id"`
	Status           string `json:"status"`
	DuplicateRequest bool   `json:"duplicate_request"`
}

func taskDelegationRoomContext(roomID string) http.Header {
	return http.Header{"X-TeamHub-Context-Kind": {"room"}, "X-TeamHub-Context-Id": {roomID}}
}

func postDelegatedTask(
	t *testing.T,
	env *testEnv,
	issued agentcredential.Issued,
	invocation, name, requirement string,
	headers ...http.Header,
) (int, []byte) {
	t.Helper()
	code, _, body := taskWorkerJSONRequest(t, env, http.MethodPost, "/api/agent/v1/tasks", issued.AccessToken,
		map[string]any{"invocation_id": mcpCreationInvocationID(invocation), "name": name, "requirement": requirement},
		headers...)
	return code, body
}

func createDelegatedTask(t *testing.T, env *testEnv, issued agentcredential.Issued, invocation, name, requirement, roomID string) delegatedTaskResponse {
	t.Helper()
	code, body := postDelegatedTask(t, env, issued, invocation, name, requirement, taskDelegationRoomContext(roomID))
	var created delegatedTaskResponse
	if code != http.StatusOK || json.Unmarshal(body, &created) != nil {
		t.Fatalf("create delegated Task=%d %s", code, body)
	}
	if !created.Accepted || created.TaskID == "" || created.Status != "running" || created.DuplicateRequest {
		t.Fatalf("created delegated Task=%+v", created)
	}
	return created
}

func delegationSponsor(t *testing.T, env *testEnv) string {
	t.Helper()
	var sponsorActorID string
	if err := env.pool.QueryRow(t.Context(), `SELECT created_by_actor_id FROM agent_registrations WHERE actor_id='actor_acme_official'`).Scan(&sponsorActorID); err != nil {
		t.Fatal(err)
	}
	return sponsorActorID
}

// assertDelegatedTask checks that a delegated Task starts at once for the
// caller's own AlterEgo, coordinated by the origin Room's Meta, without an
// approval card.
func assertDelegatedTask(t *testing.T, env *testEnv, taskID, originRoomID, sponsorActorID, name, requirement string) {
	t.Helper()
	if got := countRows(t, env, `SELECT count(*) FROM work_items task
		JOIN work_item_room_links origin ON origin.work_item_id=task.id AND origin.link_type='origin' AND origin.room_id=$2
		WHERE task.id=$1 AND task.kind='task' AND task.title=$3 AND task.description=$4
		  AND task.created_by_actor_id='actor_acme_official' AND task.task_execution_status='running'
		  AND task.task_execution_generation=1 AND task.archived_at IS NULL`, taskID, originRoomID, name, requirement); got != 1 {
		t.Fatalf("delegated Task/origin rows=%d want=1", got)
	}
	var workRoomID string
	if err := env.pool.QueryRow(t.Context(), `SELECT room_id FROM work_item_room_links WHERE work_item_id=$1 AND link_type='work'`, taskID).Scan(&workRoomID); err != nil {
		t.Fatalf("delegated Task Work Room: %v", err)
	}
	if workRoomID == originRoomID {
		t.Fatal("delegated Task reused its origin Room as Work Room")
	}
	if got := countRows(t, env, `SELECT count(*) FROM rooms room
		JOIN active_room_members owner ON owner.room_id=room.id AND owner.actor_id=$2 AND owner.role='owner'
		JOIN active_room_members creator ON creator.room_id=room.id AND creator.actor_id='actor_acme_official'
		WHERE room.id=$1 AND room.created_by_actor_id='actor_acme_official'`, workRoomID, sponsorActorID); got != 1 {
		t.Fatalf("Work Room owner/creator rows=%d want=1", got)
	}
	if got := countRows(t, env, `SELECT count(*) FROM agent_execution_contexts WHERE room_id=$1 AND context_kind='meta'`, workRoomID); got != 0 {
		t.Fatalf("Work Room Meta Contexts=%d want=0", got)
	}
	if got := countRows(t, env, `SELECT count(*) FROM task_execution_participants WHERE task_id=$1`, taskID); got != 1 {
		t.Fatalf("delegated Task participants=%d want=1", got)
	}
	if got := countRows(t, env, `SELECT count(*) FROM task_execution_participants
		WHERE task_id=$1 AND generation=1 AND actor_id='actor_acme_official' AND agent_management_id=$2
		  AND execution_context_ref->>'kind'='alter_ego'
		  AND execution_context_ref->>'agentId'=$2 AND execution_context_ref->>'taskId'=$1`,
		taskID, acmeOfficialAgentManagementID); got != 1 {
		t.Fatalf("delegated Task AlterEgo participant rows=%d want=1", got)
	}
	coordinator := fmt.Sprintf(`["meta",%q,"room",%q]`, acmeOfficialAgentManagementID, originRoomID)
	if got := countRows(t, env, `SELECT count(*) FROM task_execution_generations generation
		JOIN task_meta_callbacks callback ON callback.task_id=generation.task_id AND callback.generation=generation.generation
		  AND callback.coordinator_actor_id=generation.coordinator_actor_id AND callback.coordinator_context_key=generation.coordinator_context_key
		WHERE generation.task_id=$1 AND generation.generation=1 AND generation.source_key LIKE 'task_delegation:%'
		  AND generation.coordinator_actor_id='actor_acme_official' AND generation.coordinator_context_key=$2
		  AND generation.result_agent_actor_id='actor_acme_official'`, taskID, coordinator); got != 1 {
		t.Fatalf("delegated Task coordinator rows=%d want=1 (%s)", got, coordinator)
	}
	if got := countRows(t, env, `SELECT count(*) FROM task_effects WHERE task_id=$1 AND generation=1 AND operation='submit_agent_turn' AND status='pending'`, taskID); got != 1 {
		t.Fatalf("pending AlterEgo turn effects=%d want=1", got)
	}
	if got := countRows(t, env, `SELECT count(*) FROM messages WHERE room_id=$1 AND author_actor_id='actor_acme_official' AND body=$2`, workRoomID, requirement); got != 1 {
		t.Fatalf("Work Room initial requirement messages=%d want=1", got)
	}
	if got := countRows(t, env, `SELECT (SELECT count(*) FROM decisions WHERE kind='room_creation' AND room_id=$1)
		+(SELECT count(*) FROM message_cards WHERE room_id IN ($1,$2))`, originRoomID, workRoomID); got != 0 {
		t.Fatalf("delegation created approval requests or cards=%d", got)
	}
}

func TestMetaDelegatesTaskToItsOwnAlterEgo(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, alice, issued, roomID := newAgentCLIIdentity(t)
	sponsorActorID := delegationSponsor(t, env)
	var collaborationTaskID string
	t.Run("from a collaboration Room", func(t *testing.T) {
		created := createDelegatedTask(t, env, issued, "delegate-collaboration", "Collect release notes", "Summarize the merged changes since v1.2.", roomID)
		assertDelegatedTask(t, env, created.TaskID, roomID, sponsorActorID, "Collect release notes", "Summarize the merged changes since v1.2.")
		collaborationTaskID = created.TaskID
		// The AlterEgo shares its origin Room Meta's Task directory: the
		// scope's origin Room is the delegating Meta's Room.
		status, body := agentRuntimeStateRequest(t, env.server.Config.Handler, http.MethodPost, "/v0/agent-runtime/contexts", teamHubInternalToken, map[string]any{
			"target_residency": "active",
			"ref":              map[string]any{"kind": "alter_ego", "agent_id": acmeOfficialAgentManagementID, "task_id": created.TaskID},
		})
		var ensured struct {
			Context struct {
				SharedTaskScope struct {
					AgentID      string `json:"agent_id"`
					OriginRoomID string `json:"origin_room_id"`
					Role         string `json:"role"`
					TaskID       string `json:"task_id"`
				} `json:"shared_task_scope"`
			} `json:"context"`
		}
		scope := &ensured.Context.SharedTaskScope
		if status != http.StatusOK || json.Unmarshal(body, &ensured) != nil || scope.OriginRoomID != roomID ||
			scope.Role != "alter_ego" || scope.TaskID != created.TaskID || scope.AgentID != acmeOfficialAgentManagementID {
			t.Fatalf("AlterEgo Context=%d %s, want the shared Task scope of Room %s", status, body, roomID)
		}
	})
	t.Run("from the Sponsor Direct Room", func(t *testing.T) {
		direct := requestDirectRoom(alice, env.server.URL, "actor_acme_official")
		if direct.err != nil || direct.roomID == "" {
			t.Fatalf("Direct Room=%+v", direct)
		}
		created := createDelegatedTask(t, env, issued, "delegate-direct", "Draft the reply", "Draft a reply to the vendor email.", direct.roomID)
		assertDelegatedTask(t, env, created.TaskID, direct.roomID, sponsorActorID, "Draft the reply", "Draft a reply to the vendor email.")
	})
	t.Run("from a Room without Humans", func(t *testing.T) {
		agentOnlyRoomID := createPrivateRoom(t, env, alice, "Agent-only origin", "delegate-agent-only-room")
		if code, body := putRoomMember(t, env, alice, agentOnlyRoomID, "actor_acme_official", "member"); code != http.StatusOK {
			t.Fatalf("add Agent: %d %s", code, body)
		}
		if _, err := env.pool.Exec(t.Context(), `DELETE FROM room_members WHERE actor_id='actor_acme_alice' AND room_id=$1`, agentOnlyRoomID); err != nil {
			t.Fatal(err)
		}
		if got := countRows(t, env, `SELECT count(*) FROM active_room_members member JOIN actors actor ON actor.id=member.actor_id WHERE member.room_id=$1 AND actor.kind='human'`, agentOnlyRoomID); got != 0 {
			t.Fatalf("origin Room Humans=%d want=0", got)
		}
		created := createDelegatedTask(t, env, issued, "delegate-agent-only", "Check the build", "Report whether the nightly build passed.", agentOnlyRoomID)
		assertDelegatedTask(t, env, created.TaskID, agentOnlyRoomID, sponsorActorID, "Check the build", "Report whether the nightly build passed.")
	})
	t.Run("replays one invocation and rejects a reused one", func(t *testing.T) {
		first := createDelegatedTask(t, env, issued, "delegate-replay", "Replay probe", "Do the replay probe.", roomID)
		code, body := postDelegatedTask(t, env, issued, "delegate-replay", "Replay probe", "Do the replay probe.", taskDelegationRoomContext(roomID))
		var replay delegatedTaskResponse
		if code != http.StatusOK || json.Unmarshal(body, &replay) != nil || !replay.DuplicateRequest || replay.TaskID != first.TaskID || replay.Status != "running" {
			t.Fatalf("replay=%d %s", code, body)
		}
		code, body = postDelegatedTask(t, env, issued, "delegate-replay", "Replay probe", "A different requirement.", taskDelegationRoomContext(roomID))
		if code != http.StatusConflict || !strings.Contains(string(body), `"idempotency_conflict"`) {
			t.Fatalf("reused invocation=%d %s", code, body)
		}
		if got := countRows(t, env, `SELECT count(*) FROM work_items WHERE title='Replay probe'`); got != 1 {
			t.Fatalf("replayed Tasks=%d want=1", got)
		}
	})
	t.Run("requires the caller's Room Context", func(t *testing.T) {
		before := countRows(t, env, `SELECT count(*) FROM work_items WHERE kind='task'`)
		for _, test := range []struct {
			name    string
			headers []http.Header
		}{
			{name: "without a Context"},
			{name: "from a Task Context", headers: []http.Header{{"X-TeamHub-Context-Kind": {"task"}, "X-TeamHub-Context-Id": {collaborationTaskID}}}},
		} {
			if code, body := postDelegatedTask(t, env, issued, "delegate-forbidden-"+test.name, "Forbidden", "Must not be created.", test.headers...); code != http.StatusForbidden {
				t.Fatalf("%s=%d %s", test.name, code, body)
			}
		}
		if got := countRows(t, env, `SELECT count(*) FROM work_items WHERE kind='task'`); got != before {
			t.Fatalf("forbidden delegation created Tasks: %d -> %d", before, got)
		}
	})
}

func TestDelegatedRunningTasksAreCappedPerAgent(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, _, issued, roomID := newAgentCLIIdentity(t)
	for index := range 10 {
		createDelegatedTask(t, env, issued, fmt.Sprintf("delegate-cap-%d", index), fmt.Sprintf("Capped Task %d", index), "Run within the cap.", roomID)
	}
	code, body := postDelegatedTask(t, env, issued, "delegate-cap-over", "Over the cap", "Must wait for a free slot.", taskDelegationRoomContext(roomID))
	if code != http.StatusConflict || !strings.Contains(string(body), `"task_limit_reached"`) {
		t.Fatalf("11th running Task=%d %s", code, body)
	}
	if got := countRows(t, env, `SELECT count(*) FROM work_items WHERE kind='task' AND created_by_actor_id='actor_acme_official'`); got != 10 {
		t.Fatalf("running Tasks=%d want=10", got)
	}
}

func postAgentTaskJSON(
	env *testEnv,
	path, bearer string,
	payload any,
	extraHeaders ...http.Header,
) (int, []byte, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	request, err := http.NewRequest(http.MethodPost, env.server.URL+path, bytes.NewReader(encoded))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	for _, headers := range extraHeaders {
		for name, values := range headers {
			for _, value := range values {
				request.Header.Add(name, value)
			}
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return response.StatusCode, nil, err
	}
	return response.StatusCode, body, nil
}

func postDelegatedTaskErr(
	env *testEnv,
	issued agentcredential.Issued,
	invocation, name, requirement string,
	headers ...http.Header,
) (int, []byte, error) {
	return postAgentTaskJSON(env, "/api/agent/v1/tasks", issued.AccessToken,
		map[string]any{"invocation_id": mcpCreationInvocationID(invocation), "name": name, "requirement": requirement},
		headers...)
}

func postTaskCommandErr(
	env *testEnv,
	issued agentcredential.Issued,
	command string,
	body map[string]any,
	headers ...http.Header,
) (int, []byte, error) {
	return postAgentTaskJSON(env, "/api/agent/v1/tasks/"+command, issued.AccessToken, body, headers...)
}

func TestConcurrentTaskDelegationHasNoDeadlock(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, _, issued, roomID := newAgentCLIIdentity(t)

	t.Run("shared registration lock plus delegation advisory lock never deadlocks", func(t *testing.T) {
		tx, err := env.pool.Begin(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(t.Context())

		var txPID int32
		if err := tx.QueryRow(t.Context(), `SELECT pg_backend_pid()`).Scan(&txPID); err != nil {
			t.Fatalf("read shared-lock backend pid: %v", err)
		}

		var active string
		if err := tx.QueryRow(
			t.Context(),
			`SELECT status FROM agent_registrations WHERE actor_id='actor_acme_official' AND tenant_id=$1 FOR SHARE`,
			acmeTenant,
		).Scan(&active); err != nil {
			t.Fatalf("acquire shared registration lock: %v", err)
		}

		type createOutcome struct {
			code int
			body []byte
			err  error
		}
		done := make(chan createOutcome, 1)
		go func() {
			code, body, reqErr := postDelegatedTaskErr(
				env, issued, "delegate-lock-order", "Lock order probe", "Must not deadlock with shared registration lock.",
				taskDelegationRoomContext(roomID),
			)
			done <- createOutcome{code: code, body: body, err: reqErr}
		}()

		// Wait deterministically until the Create request either finishes under
		// the concurrent FOR SHARE lock or holds the per-Agent advisory lock /
		// blocks on a lock held by this transaction.
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		deadline := time.NewTimer(10 * time.Second)
		defer deadline.Stop()

		var outcome createOutcome
		var completedEarly bool
		for readyToLock := false; !completedEarly && !readyToLock; {
			select {
			case outcome = <-done:
				completedEarly = true
			case <-deadline.C:
				t.Fatal("timed out waiting for delegation request to complete or acquire/wait on locks")
			case <-ticker.C:
				if err := env.pool.QueryRow(t.Context(), `
					SELECT EXISTS (
						SELECT 1
						FROM pg_locks l
						JOIN pg_stat_activity a ON a.pid = l.pid
						WHERE a.datname = current_database()
						  AND l.pid <> $1
						  AND l.locktype = 'advisory'
						  AND l.granted
						  AND l.objsubid = 1
						  AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended($2, 0)
					) OR EXISTS (
						SELECT 1
						FROM pg_stat_activity a
						WHERE a.datname = current_database()
						  AND a.pid <> $1
						  AND a.wait_event_type = 'Lock'
						  AND $1 = ANY(pg_blocking_pids(a.pid))
					)`,
					txPID, "task-delegation|actor_acme_official",
				).Scan(&readyToLock); err != nil {
					t.Fatalf("poll postgres lock state: %v", err)
				}
			}
		}

		// Mirror a concurrent delegation waiting for the same per-Agent advisory lock
		// while holding FOR SHARE on agent_registrations.
		if _, err := tx.Exec(
			t.Context(),
			`SELECT pg_advisory_xact_lock(hashtextextended('task-delegation|actor_acme_official', 0))`,
		); err != nil {
			t.Fatalf("acquire advisory lock after shared registration lock: %v", err)
		}
		if err := tx.Commit(t.Context()); err != nil {
			t.Fatalf("commit shared-lock transaction: %v", err)
		}

		if !completedEarly {
			select {
			case outcome = <-done:
			case <-time.After(30 * time.Second):
				t.Fatal("delegation request timed out")
			}
		}
		if outcome.err != nil {
			t.Fatalf("delegation request under concurrent shared registration lock failed: %v", outcome.err)
		}
		if outcome.code != http.StatusOK {
			t.Fatalf("delegation under concurrent shared registration lock=%d %s", outcome.code, outcome.body)
		}
	})

	t.Run("parallel creates and wakes for the same Agent complete without deadlock", func(t *testing.T) {
		// Seed one stopped Task to exercise concurrent Task wake (Send -> checkRunningCap) alongside Creates.
		stopped := createDelegatedTask(t, env, issued, "delegate-burst-seed", "Seed task", "Seed task to stop and wake.", roomID)
		if code, body := postTaskCommand(t, env, issued, "stop", map[string]any{
			"invocation_id": mcpCreationInvocationID("delegate-burst-stop"), "task_id": stopped.TaskID,
		}, taskDelegationRoomContext(roomID)); code != http.StatusOK {
			t.Fatalf("stop seed task=%d %s", code, body)
		}

		const concurrentCreates = 6
		start := make(chan struct{})
		var ready sync.WaitGroup
		ready.Add(concurrentCreates + 1)
		var wait sync.WaitGroup
		wait.Add(concurrentCreates + 1)

		type result struct {
			name   string
			code   int
			body   []byte
			taskID string
			err    error
		}
		results := make(chan result, concurrentCreates+1)

		for index := range concurrentCreates {
			go func(index int) {
				defer wait.Done()
				ready.Done()
				<-start
				code, body, reqErr := postDelegatedTaskErr(
					env, issued,
					fmt.Sprintf("delegate-burst-%d", index),
					fmt.Sprintf("Burst task %d", index),
					"Run concurrently without deadlock.",
					taskDelegationRoomContext(roomID),
				)
				var parsed delegatedTaskResponse
				if reqErr == nil {
					_ = json.Unmarshal(body, &parsed)
				}
				results <- result{name: fmt.Sprintf("create-%d", index), code: code, body: body, taskID: parsed.TaskID, err: reqErr}
			}(index)
		}

		go func() {
			defer wait.Done()
			ready.Done()
			<-start
			code, body, reqErr := postTaskCommandErr(env, issued, "send", map[string]any{
				"invocation_id": mcpCreationInvocationID("delegate-burst-wake"),
				"task_id":       stopped.TaskID,
				"message":       "Wake alongside concurrent creates.",
				"steer":         false,
			}, taskDelegationRoomContext(roomID))
			results <- result{name: "wake", code: code, body: body, taskID: stopped.TaskID, err: reqErr}
		}()

		ready.Wait()
		close(start)
		wait.Wait()
		close(results)

		createdIDs := map[string]struct{}{}
		for item := range results {
			if item.err != nil {
				t.Fatalf("%s request failed: %v", item.name, item.err)
			}
			if item.code != http.StatusOK {
				t.Fatalf("%s failed: status=%d body=%s", item.name, item.code, item.body)
			}
			if strings.HasPrefix(item.name, "create-") {
				if item.taskID == "" {
					t.Fatalf("%s returned empty task_id: %s", item.name, item.body)
				}
				createdIDs[item.taskID] = struct{}{}
			}
		}
		if len(createdIDs) != concurrentCreates {
			t.Fatalf("distinct created tasks=%d want=%d", len(createdIDs), concurrentCreates)
		}
	})
}
