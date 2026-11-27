package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

type subscriptionTestFixture struct {
	env          *testEnv
	pool         *pgxpool.Pool
	alice        *http.Client
	roomID       string
	computerID   string
	agentActorID string
	agentMgmtID  string
	agentIssued  agentcredential.Issued
	gmailGrant   reminder.GrantReference
	githubGrant  reminder.GrantReference
	proactiveSvc *proactive.Service
	judgeCallCnt int
}

func newProactiveSubscriptionFixture(t *testing.T) *subscriptionTestFixture {
	t.Helper()
	env, pool := newConnectedAnotherMeEnv(t, nil)
	alice := env.login("alice", alicePassword)
	roomID := anotherMeRoomID(t, pool, "actor_acme_alice")

	var computerID, agentActorID, agentMgmtID string
	if err := pool.QueryRow(t.Context(), `
		SELECT computer_id FROM local_computers
		WHERE owner_tenant_id=$1 AND owner_actor_id='actor_acme_alice' AND removed_at IS NULL
	`, acmeTenant).Scan(&computerID); err != nil {
		t.Fatalf("select computer_id: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `
		SELECT actor_id, agent_management_id FROM agent_registrations
		WHERE represented_human_actor_id='actor_acme_alice' AND agent_type='anotherme'
	`).Scan(&agentActorID, &agentMgmtID); err != nil {
		t.Fatalf("select anotherme registration: %v", err)
	}
	issued, err := agentcredential.New(pool).IssueManaged(t.Context(), agentMgmtID, "Proactive subscriptions")
	if err != nil {
		t.Fatalf("issue managed credential: %v", err)
	}

	seedProactiveRules(t, pool, "actor_acme_alice", 2,
		proactiveRuleRecord(proactiveActiveRuleID, "incoming work items → act and delegate", "active", false, "learned"))
	mandatePath := "/v0/tenants/" + acmeTenant + "/me/proactive-rules/" + proactiveActiveRuleID + "/mandate"
	if status, _, body := env.request(alice, http.MethodPut, mandatePath, map[string]string{"mandate": "create_and_delegate"}, ""); status != http.StatusOK {
		t.Fatalf("grant create_and_delegate mandate status=%d body=%s", status, body)
	}

	seedGrantedConnection := func(provider, connID, grantID, identityLabel string) reminder.GrantReference {
		t.Helper()
		upstreamID := "ca_" + connID
		for _, stmt := range []struct {
			query string
			args  []any
		}{
			{`INSERT INTO external_connection_upstreams(upstream_id,account_id,user_id,toolkit_slug,auth_config_id)
				VALUES($1,'account_alice','linger:test:account:account_alice',$2,'ac_'||$2)`, []any{upstreamID, provider}},
			{`INSERT INTO external_connections(id,account_id,provider,upstream_connection_id,status,revision,remote_principal_key,identity_label,toolkit_slug,auth_config_id,auto_reminders)
				VALUES($1,'account_alice',$2,$3,'active',1,$2||':'||$4,$4,$2,'ac_'||$2,false)`, []any{connID, provider, upstreamID, identityLabel}},
			{`INSERT INTO external_connection_agent_grants(id,connection_id,tenant_id,agent_actor_id,represented_human_actor_id,status)
				VALUES($1,$2,$3,$4,'actor_acme_alice','active')`, []any{grantID, connID, acmeTenant, agentActorID}},
		} {
			if _, err := pool.Exec(t.Context(), stmt.query, stmt.args...); err != nil {
				t.Fatalf("seed %s connection: %v", provider, err)
			}
		}
		return reminder.GrantReference{
			ID:           grantID,
			Revision:     1,
			ConnectionID: connID,
			AgentActorID: agentActorID,
			TenantID:     acmeTenant,
		}
	}

	f := &subscriptionTestFixture{
		env:          env,
		pool:         pool,
		alice:        alice,
		roomID:       roomID,
		computerID:   computerID,
		agentActorID: agentActorID,
		agentMgmtID:  agentMgmtID,
		agentIssued:  issued,
		gmailGrant:   seedGrantedConnection("gmail", "connection_alice_gmail", "grant_alice_gmail", "alice@example.com"),
		githubGrant:  seedGrantedConnection("github", "connection_alice_github", "grant_alice_github", "alice"),
	}
	judge := func(context.Context, proactive.EventJudgeRequest) (string, error) {
		f.judgeCallCnt++
		return "[Proactive event: decide yourself]", nil
	}
	dayClock := func() time.Time { return time.Date(2026, 11, 27, 2, 0, 0, 0, time.UTC) } // 10:00 Beijing
	f.proactiveSvc = proactive.New(pool, judge, nil).WithClock(dayClock)
	return f
}

func (f *subscriptionTestFixture) act(t *testing.T, body map[string]any) (int, proactive.ActResult, []byte) {
	t.Helper()
	if _, hasRule := body["rule_id"]; !hasRule {
		body["rule_id"] = proactiveActiveRuleID
	}
	if _, hasTitle := body["title"]; !hasTitle {
		body["title"] = "Follow up thread"
	}
	if _, hasBrief := body["brief"]; !hasBrief {
		body["brief"] = "Handle follow-up discussion on the thread."
	}
	code, _, raw := taskWorkerJSONRequest(t, f.env, http.MethodPost, "/api/agent/v1/proactive/acts", f.agentIssued.AccessToken, body, taskDelegationRoomContext(f.roomID))
	var result proactive.ActResult
	if code == http.StatusOK {
		decode(t, raw, &result)
	}
	return code, result, raw
}

func (f *subscriptionTestFixture) startTurnForAnotherMe(t *testing.T, worker *delegatedTaskWorker, runRef string) string {
	t.Helper()
	effect := taskEffectByOperation(t, worker.bundle, "submit_agent_turn", "pending")
	worker.transition("begin_effect_dispatch", map[string]any{"effect_id": effect.ID})
	worker.transition("record_agent_turn", map[string]any{
		"effect_id": effect.ID,
		"participant_runs": []map[string]any{{
			"actor_id":            f.agentActorID,
			"agent_management_id": f.agentMgmtID,
			"agent_run_ref":       runRef,
		}},
	})
	return effect.ID
}

func (f *subscriptionTestFixture) insertAlterEgoRun(t *testing.T, taskID, runRef, finalResponse string) string {
	t.Helper()
	contextKeyBytes, _ := json.Marshal([]string{"alter_ego", f.agentMgmtID, taskID})
	contextKey := string(contextKeyBytes)
	if _, err := f.pool.Exec(t.Context(), `
		INSERT INTO agent_execution_contexts(context_key,context_kind,agent_management_id,agent_actor_id,tenant_id,task_id,target_residency)
		VALUES($1,'alter_ego',$2,$3,$4,$5,'active') ON CONFLICT (context_key) DO NOTHING
	`, contextKey, f.agentMgmtID, f.agentActorID, acmeTenant, taskID); err != nil {
		t.Fatalf("insert AlterEgo Context: %v", err)
	}
	terminal, _ := json.Marshal(map[string]any{"type": "succeeded", "finalResponse": finalResponse})
	if _, err := f.pool.Exec(t.Context(), `
		INSERT INTO agent_local_runs(run_id,context_key,status,terminal,started_at,finished_at)
		VALUES($1,$2,'succeeded',$3,clock_timestamp(),clock_timestamp())
	`, runRef, contextKey, terminal); err != nil {
		t.Fatalf("insert AlterEgo Local Run: %v", err)
	}
	return contextKey
}

func (f *subscriptionTestFixture) insertPendingApproval(t *testing.T, contextKey, decisionID string) {
	t.Helper()
	messageID := "message_" + decisionID
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments) VALUES($1,$2,$3,$4,'Approve?','[{"type":"text","content":"Approve?"}]')`, []any{messageID, acmeTenant, f.roomID, f.agentActorID}},
		{`INSERT INTO message_cards(message_id,tenant_id,room_id,decision_owner_actor_id,card_type,intent) VALUES($1,$2,$3,'actor_acme_alice','personal_notice','decision_requested')`, []any{messageID, acmeTenant, f.roomID}},
		{`INSERT INTO decisions(id,tenant_id,room_id,message_id,kind,requested_by_actor_id,decider_actor_id,alter_ego_task_id,request,view,expires_at)
			SELECT $1,$2,$3,$4,'runtime_permission',$5,'actor_acme_alice',context.task_id,
			  jsonb_build_object('context_key',$6::text,'action_digest','sha256:'||repeat('a',64),'runtime','{}'::jsonb),
			  '{"kind":"code","title":"Approve follow-up"}',clock_timestamp()+interval '10 minutes'
			FROM agent_execution_contexts context WHERE context.context_key=$6`, []any{decisionID, acmeTenant, f.roomID, messageID, f.agentActorID, contextKey}},
	} {
		if _, err := f.pool.Exec(t.Context(), stmt.query, stmt.args...); err != nil {
			t.Fatalf("insert pending approval: %v", err)
		}
	}
}

func (f *subscriptionTestFixture) mailListenerEvent(t *testing.T, listened reminder.ListenerEvent) proactive.Event {
	t.Helper()
	listened.Grant = &f.gmailGrant
	ev, ok := proactive.EventFromListener(listened)
	if !ok {
		t.Fatalf("EventFromListener returned ok=false for %+v", listened)
	}
	ev.TenantID = acmeTenant
	ev.OwnerActorID = "actor_acme_alice"
	return ev
}

func (f *subscriptionTestFixture) listPublicSubscriptions(t *testing.T, client *http.Client, workItemID string) (int, []proactive.Subscription) {
	t.Helper()
	status, _, raw := f.env.request(client, http.MethodGet, "/v0/work-items/"+workItemID+"/subscriptions", nil, "")
	var resp struct {
		Items []proactive.Subscription `json:"items"`
	}
	if status == http.StatusOK {
		decode(t, raw, &resp)
	}
	return status, resp.Items
}

// TestProactiveSubscriptionsAutoCreateAndNormalizeKeys verifies that delegated
// mandate acts automatically create canonical normalized Task Subscriptions
// across Mail, legacy herdr, herdr-core, and GitHub, reject malformed keys at
// the boundary, and skip subscription creation for non-delegated issues.
func TestProactiveSubscriptionsAutoCreateAndNormalizeKeys(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProactiveSubscriptionFixture(t)

	// Mail with explicit mixed-case account normalizes account to lowercase while
	// preserving thread ID casing.
	code, mailAct, raw := f.act(t, map[string]any{
		"event_source":      "gmail",
		"event_account":     "CONNECTION_ALICE_GMAIL",
		"event_external_id": "ThreadMixedCase_1",
		"delegate":          true,
	})
	if code != http.StatusOK || mailAct.SubscriptionID == "" {
		t.Fatalf("mail act status=%d result=%+v body=%s", code, mailAct, raw)
	}
	status, subs := f.listPublicSubscriptions(t, f.alice, mailAct.WorkItemID)
	if status != http.StatusOK || len(subs) != 1 || subs[0].ID != mailAct.SubscriptionID ||
		subs[0].SourceType != proactive.SubscriptionSourceMail ||
		subs[0].NormalizedSourceKey != "connection_alice_gmail:ThreadMixedCase_1" ||
		subs[0].Status != proactive.SubscriptionStatusActive {
		t.Fatalf("mail subscription=%d %+v", status, subs)
	}

	// Mail omitting event_account resolves unambiguously when the owner has one
	// active granted connection for that provider.
	code, mailAutoAct, raw := f.act(t, map[string]any{
		"event_source":      "gmail",
		"event_external_id": "thread_auto_1",
		"delegate":          true,
	})
	if code != http.StatusOK || mailAutoAct.SubscriptionID == "" {
		t.Fatalf("mail auto-account act status=%d result=%+v body=%s", code, mailAutoAct, raw)
	}
	_, subs = f.listPublicSubscriptions(t, f.alice, mailAutoAct.WorkItemID)
	if len(subs) != 1 || subs[0].NormalizedSourceKey != "connection_alice_gmail:thread_auto_1" {
		t.Fatalf("mail auto-account subscription=%+v", subs)
	}

	// Legacy herdr strips the state-change sequence suffix so future transitions
	// on the same pane match the Subscription.
	code, herdrAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceHerdr,
		"event_external_id": f.computerID + "/w1:p9/42",
		"delegate":          true,
	})
	if code != http.StatusOK || herdrAct.SubscriptionID == "" {
		t.Fatalf("herdr act status=%d result=%+v body=%s", code, herdrAct, raw)
	}
	_, subs = f.listPublicSubscriptions(t, f.alice, herdrAct.WorkItemID)
	if len(subs) != 1 || subs[0].SourceType != proactive.SubscriptionSourceHerdr ||
		subs[0].NormalizedSourceKey != f.computerID+"/w1:p9" {
		t.Fatalf("herdr subscription=%+v", subs)
	}

	// herdr-core strips the trailing turn and status_ms segments while keeping
	// the remote machine + terminal address intact.
	code, herdrCoreAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceHerdrCore,
		"event_external_id": f.computerID + "/local/term_7/3/1732670000",
		"delegate":          true,
	})
	if code != http.StatusOK || herdrCoreAct.SubscriptionID == "" {
		t.Fatalf("herdr-core act status=%d result=%+v body=%s", code, herdrCoreAct, raw)
	}
	_, subs = f.listPublicSubscriptions(t, f.alice, herdrCoreAct.WorkItemID)
	if len(subs) != 1 || subs[0].SourceType != proactive.SubscriptionSourceHerdr ||
		subs[0].NormalizedSourceKey != f.computerID+"/local/term_7" {
		t.Fatalf("herdr-core subscription=%+v", subs)
	}

	// GitHub PR URL normalizes to canonical lowercase owner/repo#number.
	code, ghAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceGitHub,
		"event_external_id": "https://github.com/OldWinter/Linger/pull/6/files#diff-1",
		"delegate":          true,
	})
	if code != http.StatusOK || ghAct.SubscriptionID == "" {
		t.Fatalf("github act status=%d result=%+v body=%s", code, ghAct, raw)
	}
	_, subs = f.listPublicSubscriptions(t, f.alice, ghAct.WorkItemID)
	if len(subs) != 1 || subs[0].SourceType != proactive.SubscriptionSourceGitHub ||
		subs[0].NormalizedSourceKey != "oldwinter/linger#6" {
		t.Fatalf("github subscription=%+v", subs)
	}

	// Malformed external source keys are rejected cleanly at the boundary without
	// creating a Task or Subscription.
	beforeTasks := countRows(t, f.env, `SELECT count(*) FROM work_items WHERE tenant_id=$1`, acmeTenant)
	code, _, raw = f.act(t, map[string]any{
		"event_source":      proactive.SourceGitHub,
		"event_external_id": "not-a-valid-github-ref",
		"delegate":          true,
	})
	if code != http.StatusBadRequest {
		t.Fatalf("malformed github key status=%d want=400 body=%s", code, raw)
	}
	if afterTasks := countRows(t, f.env, `SELECT count(*) FROM work_items WHERE tenant_id=$1`, acmeTenant); afterTasks != beforeTasks {
		t.Fatalf("malformed github key created a Work Item: before=%d after=%d", beforeTasks, afterTasks)
	}

	// Non-delegated issue creation does not create a Task Subscription.
	code, issueAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceGitHub,
		"event_external_id": "oldwinter/linger#7",
		"delegate":          false,
	})
	if code != http.StatusOK || issueAct.SubscriptionID != "" {
		t.Fatalf("non-delegated act status=%d result=%+v body=%s", code, issueAct, raw)
	}
}

// TestProactiveSubscriptionsRouteActiveFollowUpsAndDeduplicate proves that
// follow-up events on subscribed threads route directly into running and
// waiting_for_approval Tasks without invoking the proactive judge, record
// subscription_event input revisions and delivery audit rows, and deduplicate
// replayed events.
func TestProactiveSubscriptionsRouteActiveFollowUpsAndDeduplicate(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProactiveSubscriptionFixture(t)

	// Start a Mail-subscribed delegated Task (status = running).
	code, mailAct, raw := f.act(t, map[string]any{
		"event_source":      "gmail",
		"event_account":     f.gmailGrant.ConnectionID,
		"event_external_id": "thread_active_1",
		"delegate":          true,
	})
	if code != http.StatusOK || mailAct.SubscriptionID == "" {
		t.Fatalf("delegate mail task status=%d body=%s", code, raw)
	}

	// Route a human reply directly into the running Task without waking AnotherMe
	// or running the proactive judge.
	humanReply := f.mailListenerEvent(t, reminder.ListenerEvent{
		Source:    reminder.ListenerGmail,
		MessageID: "msg_reply_1",
		ThreadID:  "thread_active_1",
		From:      "Client Lisa <lisa@client.example>",
		Subject:   "Re: Contract terms",
		Snippet:   "Looks good, please also include the Q4 pricing schedule.",
	})
	outcome, err := f.proactiveSvc.HandleEvent(t.Context(), humanReply)
	if err != nil || outcome.Skipped != "routed_to_subscription" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "routed" || outcome.RoutedTasks[0].TaskID != mailAct.WorkItemID ||
		outcome.RoutedTasks[0].SubscriptionID != mailAct.SubscriptionID {
		t.Fatalf("active mail follow-up outcome=%+v err=%v", outcome, err)
	}
	if f.judgeCallCnt != 0 {
		t.Fatalf("proactive judge called %d times for subscribed event, want 0", f.judgeCallCnt)
	}
	if wakes := countRows(t, f.env, `SELECT count(*) FROM proactive_pending_wakes WHERE room_id=$1`, f.roomID); wakes != 0 {
		t.Fatalf("subscribed event created %d proactive_pending_wakes, want 0", wakes)
	}
	if revs := countRows(t, f.env, `
		SELECT count(*) FROM task_input_revisions input
		JOIN task_effects effect ON effect.task_id=input.task_id AND input.message_effect_ids ? effect.id
		WHERE input.task_id=$1 AND input.cause='subscription_event' AND input.input_revision=2
		  AND effect.operation='submit_agent_turn' AND effect.status='pending'
		  AND effect.payload->'message'->>'raw_message' LIKE '%Q4 pricing schedule%'
	`, mailAct.WorkItemID); revs != 1 {
		t.Fatalf("subscription_event input revision + effect rows=%d want=1", revs)
	}
	if deliveries := countRows(t, f.env, `
		SELECT count(*) FROM task_subscription_deliveries
		WHERE subscription_id=$1 AND actor_kind='human' AND outcome='routed' AND task_execution_revision IS NOT NULL
	`, mailAct.SubscriptionID); deliveries != 1 {
		t.Fatalf("delivery audit rows=%d want=1", deliveries)
	}

	// Replaying the exact same event is deduplicated with no extra input revision.
	replay, err := f.proactiveSvc.HandleEvent(t.Context(), humanReply)
	if err != nil || replay.Skipped != "routed_to_subscription" || len(replay.RoutedTasks) != 1 ||
		replay.RoutedTasks[0].Outcome != "already_delivered" {
		t.Fatalf("replayed follow-up outcome=%+v err=%v", replay, err)
	}
	if revs := countRows(t, f.env, `SELECT count(*) FROM task_input_revisions WHERE task_id=$1 AND cause='subscription_event'`, mailAct.WorkItemID); revs != 1 {
		t.Fatalf("replayed event created duplicate input revision: %d", revs)
	}

	// Non-human follow-ups (e.g. herdr-core machine transition) DO route into an
	// active Task, including one currently in waiting_for_approval.
	code, herdrAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceHerdrCore,
		"event_external_id": f.computerID + "/local/term_active/1/1000",
		"delegate":          true,
	})
	if code != http.StatusOK || herdrAct.SubscriptionID == "" {
		t.Fatalf("delegate herdr-core task status=%d body=%s", code, raw)
	}
	// Drain the Mail task claim first so claimDelegatedTask can claim the
	// herdr-core task or claim in order until we get herdrAct.WorkItemID.
	worker1 := claimTaskWorker(t, f.env, "worker-active-1")
	var herdrWorker *delegatedTaskWorker
	if worker1.Execution.TaskID == herdrAct.WorkItemID {
		herdrWorker = &delegatedTaskWorker{t: t, env: f.env, taskID: herdrAct.WorkItemID, bundle: worker1}
	} else {
		worker2 := claimDelegatedTask(t, f.env, herdrAct.WorkItemID, "worker-active-2")
		herdrWorker = worker2
	}
	effectID := f.startTurnForAnotherMe(t, herdrWorker, "run-herdr-waiting")
	contextKey := f.insertAlterEgoRun(t, herdrAct.WorkItemID, "run-herdr-waiting", "Waiting for approval.")
	f.insertPendingApproval(t, contextKey, "decision_sub_waiting")
	herdrWorker.endTurn(effectID, "run-herdr-waiting", "succeeded", "")
	herdrWorker.advance()
	assertDelegatedTaskState(t, f.env, herdrAct.WorkItemID, "waiting_for_approval", "pending_approval")

	herdrBlocked := proactive.HerdrCoreEvent(acmeTenant, "actor_acme_alice", proactive.HerdrCoreReport{
		ComputerID: f.computerID,
		Kind:       proactive.HerdrCoreAgentBlocked,
		Address:    "local/term_active",
		Machine:    "local",
		Turn:       2,
		StatusMs:   2000,
		Template:   "codex",
		Tail:       "Approve running migration?",
	})
	outcome, err = f.proactiveSvc.HandleEvent(t.Context(), herdrBlocked)
	if err != nil || outcome.Skipped != "routed_to_subscription" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "routed" || outcome.RoutedTasks[0].TaskStatus != "running" {
		t.Fatalf("active waiting_for_approval non-human follow-up outcome=%+v err=%v", outcome, err)
	}
	assertDelegatedTaskState(t, f.env, herdrAct.WorkItemID, "running", "")
}

// TestProactiveSubscriptionsHumanOnlyResumeForEndedTasks enforces the owner's
// resume policy across all three ended Task states (idle, failed, canceled):
// bot, CI, automated/no-reply mail, herdr machine transitions, and unknown-actor
// events must never revive an ended Task, whereas verified human-authored
// follow-up messages resume it cleanly.
func TestProactiveSubscriptionsHumanOnlyResumeForEndedTasks(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProactiveSubscriptionFixture(t)

	// 1. Ended state: idle (GitHub PR).
	code, ghAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceGitHub,
		"event_external_id": "oldwinter/linger#42",
		"delegate":          true,
	})
	if code != http.StatusOK || ghAct.SubscriptionID == "" {
		t.Fatalf("delegate github task status=%d body=%s", code, raw)
	}
	ghWorker := claimDelegatedTask(t, f.env, ghAct.WorkItemID, "worker-gh-idle")
	ghEffectID := f.startTurnForAnotherMe(t, ghWorker, "run-gh-idle")
	f.insertAlterEgoRun(t, ghAct.WorkItemID, "run-gh-idle", "PR review complete.")
	ghWorker.endTurn(ghEffectID, "run-gh-idle", "succeeded", "")
	ghWorker.advance()
	assertDelegatedTaskState(t, f.env, ghAct.WorkItemID, "idle", "run_succeeded")

	for _, tc := range []struct {
		name  string
		input proactive.GitHubEventInput
	}{
		{
			name: "github bot comment",
			input: proactive.GitHubEventInput{
				Grant: &f.githubGrant, TenantID: acmeTenant, OwnerActorID: "actor_acme_alice",
				Owner: "OldWinter", Repo: "Linger", Number: 42, EventType: "issue_comment", CommentID: "c_bot_1",
				Summary: "Bumps dependency version", Actor: &proactive.EventActor{Kind: proactive.EventActorHuman, Handle: "dependabot[bot]"},
			},
		},
		{
			name: "github CI check_run",
			input: proactive.GitHubEventInput{
				Grant: &f.githubGrant, TenantID: acmeTenant, OwnerActorID: "actor_acme_alice",
				Owner: "oldwinter", Repo: "linger", Number: 42, EventType: "check_run", CommentID: "chk_1",
				Summary: "CI completed", Actor: &proactive.EventActor{Kind: proactive.EventActorHuman, Handle: "alice"},
			},
		},
		{
			name: "github unknown actor",
			input: proactive.GitHubEventInput{
				Grant: &f.githubGrant, TenantID: acmeTenant, OwnerActorID: "actor_acme_alice",
				Owner: "oldwinter", Repo: "linger", Number: 42, EventType: "issue_comment", CommentID: "c_unknown_1",
				Summary: "Untrusted webhook without actor metadata", Actor: nil,
			},
		},
	} {
		ev, err := proactive.GitHubEvent(tc.input)
		if err != nil {
			t.Fatalf("%s build event: %v", tc.name, err)
		}
		outcome, err := f.proactiveSvc.HandleEvent(t.Context(), ev)
		if err != nil || outcome.Skipped != "subscription_skipped_non_human_ended" || len(outcome.RoutedTasks) != 1 ||
			outcome.RoutedTasks[0].Outcome != "skipped_non_human_ended" {
			t.Fatalf("%s unexpectedly resumed or fell through: outcome=%+v err=%v", tc.name, outcome, err)
		}
		assertDelegatedTaskState(t, f.env, ghAct.WorkItemID, "idle", "run_succeeded")
		if attempts := countRows(t, f.env, `SELECT count(*) FROM task_attempts WHERE task_id=$1`, ghAct.WorkItemID); attempts != 1 {
			t.Fatalf("%s created a new Attempt: count=%d", tc.name, attempts)
		}
	}

	// Verified human comment resumes the idle GitHub Task.
	humanGH, err := proactive.GitHubEvent(proactive.GitHubEventInput{
		Grant: &f.githubGrant, TenantID: acmeTenant, OwnerActorID: "actor_acme_alice",
		Owner: "OLDWINTER", Repo: "LINGER", Number: 42, EventType: "issue_comment", CommentID: "c_human_1",
		Summary: "Please also handle the edge case for Outlook conversationId.",
		Actor:   &proactive.EventActor{Kind: proactive.EventActorHuman, Handle: "oldwinter", DisplayName: "OldWinter"},
	})
	if err != nil {
		t.Fatalf("build human github event: %v", err)
	}
	outcome, err := f.proactiveSvc.HandleEvent(t.Context(), humanGH)
	if err != nil || outcome.Skipped != "routed_to_subscription" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "resumed" || outcome.RoutedTasks[0].TaskStatus != "running" {
		t.Fatalf("human github resume outcome=%+v err=%v", outcome, err)
	}
	assertDelegatedTaskState(t, f.env, ghAct.WorkItemID, "running", "")
	if attempts := countRows(t, f.env, `SELECT count(*) FROM task_attempts WHERE task_id=$1`, ghAct.WorkItemID); attempts != 2 {
		t.Fatalf("human github resume attempts=%d want=2", attempts)
	}
	if got := countRows(t, f.env, `SELECT count(*) FROM task_subscription_deliveries WHERE subscription_id=$1 AND outcome='resumed' AND actor_kind='human'`, ghAct.SubscriptionID); got != 1 {
		t.Fatalf("resumed delivery rows=%d want=1", got)
	}

	// 2. Ended state: failed (Mail thread).
	code, mailAct, raw := f.act(t, map[string]any{
		"event_source":      "gmail",
		"event_account":     f.gmailGrant.ConnectionID,
		"event_external_id": "thread_failed_1",
		"delegate":          true,
	})
	if code != http.StatusOK || mailAct.SubscriptionID == "" {
		t.Fatalf("delegate mail task status=%d body=%s", code, raw)
	}
	// Claim until we hold the mail task (the resumed GitHub task may also be runnable).
	var mailWorker *delegatedTaskWorker
	for i := 0; i < 3; i++ {
		bundle := claimTaskWorker(t, f.env, "worker-mail-fail-"+string(rune('a'+i)))
		if bundle.Execution.TaskID == mailAct.WorkItemID {
			mailWorker = &delegatedTaskWorker{t: t, env: f.env, taskID: mailAct.WorkItemID, bundle: bundle}
			break
		}
	}
	if mailWorker == nil {
		t.Fatalf("could not claim mail task %s", mailAct.WorkItemID)
	}
	mailEffectID := f.startTurnForAnotherMe(t, mailWorker, "run-mail-fail")
	mailWorker.endTurn(mailEffectID, "run-mail-fail", "failed", "temporary provider error")
	mailWorker.advance()
	assertDelegatedTaskState(t, f.env, mailAct.WorkItemID, "failed", "agent_run_failed")

	for _, listenerEv := range []reminder.ListenerEvent{
		{
			Source: reminder.ListenerGmail, MessageID: "msg_noreply", ThreadID: "thread_failed_1",
			From: "GitHub <noreply@github.com>", Subject: "Automated notice", Snippet: "Build failed",
		},
		{
			Source: reminder.ListenerGmail, MessageID: "msg_ooo", ThreadID: "thread_failed_1",
			From: "Lisa <lisa@client.example>", AutoSubmitted: true, Subject: "Out of office", Snippet: "Back Monday",
		},
	} {
		ev := f.mailListenerEvent(t, listenerEv)
		outcome, err := f.proactiveSvc.HandleEvent(t.Context(), ev)
		if err != nil || outcome.Skipped != "subscription_skipped_non_human_ended" || len(outcome.RoutedTasks) != 1 ||
			outcome.RoutedTasks[0].Outcome != "skipped_non_human_ended" {
			t.Fatalf("automated mail %s resumed failed task: outcome=%+v err=%v", listenerEv.MessageID, outcome, err)
		}
		assertDelegatedTaskState(t, f.env, mailAct.WorkItemID, "failed", "agent_run_failed")
	}

	humanMail := f.mailListenerEvent(t, reminder.ListenerEvent{
		Source: reminder.ListenerGmail, MessageID: "msg_human_retry", ThreadID: "thread_failed_1",
		From: "Lisa <lisa@client.example>", Subject: "Re: Quote", Snippet: "Can you retry sending the revised quote?",
	})
	outcome, err = f.proactiveSvc.HandleEvent(t.Context(), humanMail)
	if err != nil || outcome.Skipped != "routed_to_subscription" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "resumed" || outcome.RoutedTasks[0].TaskStatus != "running" {
		t.Fatalf("human mail resume failed task outcome=%+v err=%v", outcome, err)
	}
	assertDelegatedTaskState(t, f.env, mailAct.WorkItemID, "running", "")

	// 3. Ended state: canceled (herdr pane stopped via tasks/stop).
	code, herdrAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceHerdr,
		"event_external_id": f.computerID + "/w1:p5/10",
		"delegate":          true,
	})
	if code != http.StatusOK || herdrAct.SubscriptionID == "" {
		t.Fatalf("delegate herdr task status=%d body=%s", code, raw)
	}
	code, stopBody := postTaskCommand(t, f.env, f.agentIssued, "stop", map[string]any{
		"invocation_id": mcpCreationInvocationID("sub-stop-herdr"),
		"task_id":       herdrAct.WorkItemID,
	}, taskDelegationRoomContext(f.roomID))
	if code != http.StatusOK || !strings.Contains(string(stopBody), `"status":"canceled"`) {
		t.Fatalf("stop herdr task status=%d body=%s", code, stopBody)
	}
	assertDelegatedTaskState(t, f.env, herdrAct.WorkItemID, "canceled", "stopped")

	herdrMachine := proactive.HerdrEvent(acmeTenant, "actor_acme_alice", proactive.HerdrReport{
		ComputerID: f.computerID, Kind: proactive.HerdrAgentFinished, PaneID: "w1:p5", StateChangeSeq: 11, Agent: "codex", Tail: "Done.",
	})
	outcome, err = f.proactiveSvc.HandleEvent(t.Context(), herdrMachine)
	if err != nil || outcome.Skipped != "subscription_skipped_non_human_ended" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "skipped_non_human_ended" {
		t.Fatalf("herdr machine event resumed canceled task: outcome=%+v err=%v", outcome, err)
	}
	assertDelegatedTaskState(t, f.env, herdrAct.WorkItemID, "canceled", "stopped")

	humanHerdr := proactive.Event{
		ComputerID:   f.computerID,
		TenantID:     acmeTenant,
		OwnerActorID: "actor_acme_alice",
		Source:       proactive.SourceHerdr,
		ExternalID:   f.computerID + "/w1:p5/12",
		State:        "12",
		Kind:         "human_message",
		Summary:      "Human typed follow-up instruction in pane w1:p5",
		Herdr:        &proactive.HerdrPane{PaneID: "w1:p5", StateChangeSeq: 12},
		Actor:        &proactive.EventActor{Kind: proactive.EventActorHuman, DisplayName: "Alice"},
	}
	outcome, err = f.proactiveSvc.HandleEvent(t.Context(), humanHerdr)
	if err != nil || outcome.Skipped != "routed_to_subscription" || len(outcome.RoutedTasks) != 1 ||
		outcome.RoutedTasks[0].Outcome != "resumed" || outcome.RoutedTasks[0].TaskStatus != "running" {
		t.Fatalf("human herdr resume canceled task outcome=%+v err=%v", outcome, err)
	}
	assertDelegatedTaskState(t, f.env, herdrAct.WorkItemID, "running", "")
	if f.judgeCallCnt != 0 {
		t.Fatalf("proactive judge called %d times during subscription tests, want 0", f.judgeCallCnt)
	}
}

// TestProactiveSubscriptionsDropPermissionsAndIsolation verifies that both the
// task owner (human) and Another Me (agent) can durably and idempotently drop
// Subscriptions, that peer Humans and AlterEgo Task Contexts are rejected, and
// that dropping immediately stops follow-up routing and task resumption.
func TestProactiveSubscriptionsDropPermissionsAndIsolation(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProactiveSubscriptionFixture(t)
	bob := seedPeerHuman(t, f.env)

	code, mailAct, raw := f.act(t, map[string]any{
		"event_source":      "gmail",
		"event_account":     f.gmailGrant.ConnectionID,
		"event_external_id": "thread_drop_owner",
		"delegate":          true,
	})
	if code != http.StatusOK || mailAct.SubscriptionID == "" {
		t.Fatalf("delegate mail task status=%d body=%s", code, raw)
	}
	code, ghAct, raw := f.act(t, map[string]any{
		"event_source":      proactive.SourceGitHub,
		"event_external_id": "oldwinter/linger#99",
		"delegate":          true,
	})
	if code != http.StatusOK || ghAct.SubscriptionID == "" {
		t.Fatalf("delegate github task status=%d body=%s", code, raw)
	}

	// Peer human in the same Tenant never sees Alice's subscriptions and is
	// rejected with 403 when attempting to drop one.
	status, bobSubs := f.listPublicSubscriptions(t, bob, mailAct.WorkItemID)
	if status != http.StatusOK || len(bobSubs) != 0 {
		t.Fatalf("peer human list status=%d subs=%+v want=200/empty", status, bobSubs)
	}
	status, _, dropBody := f.env.request(bob, http.MethodPost,
		"/v0/work-items/"+mailAct.WorkItemID+"/subscriptions/"+mailAct.SubscriptionID+"/drop",
		map[string]string{"reason": "unauthorized"}, "")
	if status != http.StatusForbidden {
		t.Fatalf("peer human drop status=%d want=403 body=%s", status, dropBody)
	}

	// Owner (Alice) drops the Mail subscription; the operation is durable,
	// idempotent, records dropped_by_kind=owner, and emits a Room Event.
	eventsBefore := countRows(t, f.env, `SELECT count(*) FROM room_events WHERE room_id=$1 AND event_type='work_item.changed'`, f.roomID)
	status, _, dropBody = f.env.request(f.alice, http.MethodPost,
		"/v0/work-items/"+mailAct.WorkItemID+"/subscriptions/"+mailAct.SubscriptionID+"/drop",
		map[string]string{"reason": "Handled manually"}, "")
	if status != http.StatusOK {
		t.Fatalf("owner drop status=%d body=%s", status, dropBody)
	}
	var droppedByOwner proactive.Subscription
	decode(t, dropBody, &droppedByOwner)
	if droppedByOwner.Status != proactive.SubscriptionStatusDropped ||
		droppedByOwner.DroppedByKind != proactive.SubscriptionDroppedByOwner ||
		droppedByOwner.DroppedByActorID != "actor_acme_alice" ||
		droppedByOwner.DropReason != "Handled manually" ||
		droppedByOwner.DroppedAt == nil {
		t.Fatalf("owner dropped subscription=%+v", droppedByOwner)
	}
	if eventsAfter := countRows(t, f.env, `SELECT count(*) FROM room_events WHERE room_id=$1 AND event_type='work_item.changed'`, f.roomID); eventsAfter <= eventsBefore {
		t.Fatalf("owner drop emitted no work_item.changed Room Event: before=%d after=%d", eventsBefore, eventsAfter)
	}

	// Re-dropping is idempotent and preserves the original drop metadata.
	status, _, replayDropBody := f.env.request(f.alice, http.MethodPost,
		"/v0/work-items/"+mailAct.WorkItemID+"/subscriptions/"+mailAct.SubscriptionID+"/drop",
		map[string]string{"reason": "Second reason ignored"}, "")
	if status != http.StatusOK {
		t.Fatalf("owner replay drop status=%d body=%s", status, replayDropBody)
	}
	var replayDropped proactive.Subscription
	decode(t, replayDropBody, &replayDropped)
	if replayDropped.DropReason != "Handled manually" || replayDropped.DroppedAt == nil || !replayDropped.DroppedAt.Equal(*droppedByOwner.DroppedAt) {
		t.Fatalf("owner replay drop mutated audit fields: first=%+v second=%+v", droppedByOwner, replayDropped)
	}

	// AlterEgo in Task Context cannot list or drop Subscriptions.
	taskContext := http.Header{"X-TeamHub-Context-Kind": {"task"}, "X-TeamHub-Context-Id": {ghAct.WorkItemID}}
	for _, endpoint := range []struct {
		path string
		body map[string]any
	}{
		{"/api/agent/v1/proactive/subscriptions/list", map[string]any{}},
		{"/api/agent/v1/proactive/subscriptions/drop", map[string]any{"subscription_id": ghAct.SubscriptionID}},
	} {
		code, _, body := taskWorkerJSONRequest(t, f.env, http.MethodPost, endpoint.path, f.agentIssued.AccessToken, endpoint.body, taskContext)
		if code != http.StatusForbidden {
			t.Fatalf("%s in Task Context status=%d want=403 body=%s", endpoint.path, code, body)
		}
	}

	// Another Me lists active subscriptions (sees only GitHub; Mail is dropped),
	// then lists with include_dropped=true (sees both).
	code, _, listRaw := taskWorkerJSONRequest(t, f.env, http.MethodPost, "/api/agent/v1/proactive/subscriptions/list",
		f.agentIssued.AccessToken, map[string]any{}, taskDelegationRoomContext(f.roomID))
	var agentList struct {
		Items []proactive.Subscription `json:"items"`
	}
	if code != http.StatusOK {
		t.Fatalf("agent list active status=%d body=%s", code, listRaw)
	}
	decode(t, listRaw, &agentList)
	if len(agentList.Items) != 1 || agentList.Items[0].ID != ghAct.SubscriptionID {
		t.Fatalf("agent active list=%+v want only %s", agentList.Items, ghAct.SubscriptionID)
	}
	code, _, listAllRaw := taskWorkerJSONRequest(t, f.env, http.MethodPost, "/api/agent/v1/proactive/subscriptions/list",
		f.agentIssued.AccessToken, map[string]any{"include_dropped": true}, taskDelegationRoomContext(f.roomID))
	if code != http.StatusOK {
		t.Fatalf("agent list all status=%d body=%s", code, listAllRaw)
	}
	decode(t, listAllRaw, &agentList)
	if len(agentList.Items) != 2 {
		t.Fatalf("agent include_dropped list=%+v want=2", agentList.Items)
	}

	// Another Me drops the GitHub subscription; re-dropping reports replay=true.
	code, _, agentDropRaw := taskWorkerJSONRequest(t, f.env, http.MethodPost, "/api/agent/v1/proactive/subscriptions/drop",
		f.agentIssued.AccessToken, map[string]any{"subscription_id": ghAct.SubscriptionID, "reason": "PR merged"}, taskDelegationRoomContext(f.roomID))
	if code != http.StatusOK {
		t.Fatalf("agent drop status=%d body=%s", code, agentDropRaw)
	}
	var agentDrop proactive.DropSubscriptionResult
	decode(t, agentDropRaw, &agentDrop)
	if agentDrop.Replay || agentDrop.Subscription.Status != proactive.SubscriptionStatusDropped ||
		agentDrop.Subscription.DroppedByKind != proactive.SubscriptionDroppedByAnotherMe ||
		agentDrop.Subscription.DroppedByActorID != f.agentActorID ||
		agentDrop.Subscription.DropReason != "PR merged" {
		t.Fatalf("agent drop result=%+v", agentDrop)
	}
	code, _, agentDropReplayRaw := taskWorkerJSONRequest(t, f.env, http.MethodPost, "/api/agent/v1/proactive/subscriptions/drop",
		f.agentIssued.AccessToken, map[string]any{"subscription_id": ghAct.SubscriptionID, "reason": "ignored"}, taskDelegationRoomContext(f.roomID))
	if code != http.StatusOK {
		t.Fatalf("agent replay drop status=%d body=%s", code, agentDropReplayRaw)
	}
	var agentDropReplay proactive.DropSubscriptionResult
	decode(t, agentDropReplayRaw, &agentDropReplay)
	if !agentDropReplay.Replay || agentDropReplay.Subscription.DropReason != "PR merged" {
		t.Fatalf("agent replay drop=%+v", agentDropReplay)
	}

	// Stop the GitHub task to prove a dropped subscription neither routes into an
	// active Task nor resumes an ended Task.
	code, stopBody := postTaskCommand(t, f.env, f.agentIssued, "stop", map[string]any{
		"invocation_id": mcpCreationInvocationID("sub-stop-dropped-gh"),
		"task_id":       ghAct.WorkItemID,
	}, taskDelegationRoomContext(f.roomID))
	if code != http.StatusOK {
		t.Fatalf("stop dropped github task status=%d body=%s", code, stopBody)
	}
	assertDelegatedTaskState(t, f.env, ghAct.WorkItemID, "canceled", "stopped")

	// Human events on both dropped threads must NOT route to either Task; they
	// fall through to normal proactive judging instead.
	mailFollowUp := f.mailListenerEvent(t, reminder.ListenerEvent{
		Source: reminder.ListenerGmail, MessageID: "msg_after_drop", ThreadID: "thread_drop_owner",
		From: "Lisa <lisa@client.example>", Subject: "Re: Follow-up", Snippet: "Any updates?",
	})
	mailOutcome, err := f.proactiveSvc.HandleEvent(t.Context(), mailFollowUp)
	if err != nil || mailOutcome.Skipped != "" || len(mailOutcome.RoutedTasks) != 0 {
		t.Fatalf("dropped mail thread still routed: outcome=%+v err=%v", mailOutcome, err)
	}
	if revs := countRows(t, f.env, `SELECT count(*) FROM task_input_revisions WHERE task_id=$1 AND cause='subscription_event'`, mailAct.WorkItemID); revs != 0 {
		t.Fatalf("dropped mail thread inserted %d subscription_event revisions", revs)
	}

	ghFollowUp, err := proactive.GitHubEvent(proactive.GitHubEventInput{
		Grant: &f.githubGrant, TenantID: acmeTenant, OwnerActorID: "actor_acme_alice",
		Owner: "oldwinter", Repo: "linger", Number: 99, EventType: "issue_comment", CommentID: "c_after_drop",
		Summary: "Human comment after PR merged", Actor: &proactive.EventActor{Kind: proactive.EventActorHuman, Handle: "oldwinter"},
	})
	if err != nil {
		t.Fatalf("build github follow-up: %v", err)
	}
	ghOutcome, err := f.proactiveSvc.HandleEvent(t.Context(), ghFollowUp)
	if err != nil || ghOutcome.Skipped != "" || len(ghOutcome.RoutedTasks) != 0 {
		t.Fatalf("dropped github PR still routed: outcome=%+v err=%v", ghOutcome, err)
	}
	assertDelegatedTaskState(t, f.env, ghAct.WorkItemID, "canceled", "stopped")
	if deliveries := countRows(t, f.env, `SELECT count(*) FROM task_subscription_deliveries WHERE subscription_id IN ($1,$2)`, mailAct.SubscriptionID, ghAct.SubscriptionID); deliveries != 0 {
		t.Fatalf("dropped subscriptions recorded %d deliveries, want 0", deliveries)
	}
	if f.judgeCallCnt != 2 {
		t.Fatalf("dropped events should fall through to proactive judge twice, got %d", f.judgeCallCnt)
	}
}
