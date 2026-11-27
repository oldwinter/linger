package integration_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentsendmessage"
)

// TestAgentInboxMessageDisposition pins the one decision the batch read, the
// acceptance recheck, reply obligations and active Runs share.
func TestAgentInboxMessageDisposition(t *testing.T) {
	allowParallelIntegrationTest(t)
	env := newRuntimeStateTestEnv(t)
	const taskID = "task_disposition"
	insertDirectInboxTask(t, env, taskID, false)
	alter, err := env.service.EnsureContext(t.Context(), agentruntimestate.EnsureContextInput{TargetResidency: "suspended",
		Ref: agentruntimestate.ContextRef{Kind: "alter_ego", AgentID: testRuntimeAgentID, TaskID: taskID},
	})
	if err != nil {
		t.Fatal(err)
	}
	const mention = `[{"type":"reference","target_type":"agent","target":"actor_acme_official","content":"@A"}]`
	seedPeerHumanActor(t, env.pool)
	if _, err := env.pool.Exec(t.Context(), `
INSERT INTO actors(id,tenant_id,kind,display_name,handle)
 VALUES('actor_disposition_peer','tenant_acme','agent','Research Analyst','@research-analyst');
INSERT INTO rooms(id,tenant_id,name,created_by_actor_id) VALUES('room_disposition_thread','tenant_acme','Disposition thread','actor_acme_alice');
INSERT INTO rooms(id,tenant_id,name,created_by_actor_id,direct_human_actor_id,direct_agent_actor_id)
 VALUES('room_disposition_direct','tenant_acme','Disposition direct','actor_acme_alice','actor_acme_alice','actor_acme_official');
INSERT INTO rooms(id,tenant_id,name,created_by_actor_id) VALUES('room_disposition_direct_thread','tenant_acme','Disposition direct thread','actor_acme_alice');
INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments,message_kind,card_context_message_id)
SELECT id,'tenant_acme',room,author,'body','[{"type":"text","content":"body"}]',kind,card FROM (VALUES
 ('d-plain','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-mention','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-other-agent-mention','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-both-agents-mention','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-human-only-mention','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-peer-agent-reply','room_runtime_inbox','actor_disposition_peer','conversation',NULL),
 ('d-peer-agent-mention-me','room_runtime_inbox','actor_disposition_peer','conversation',NULL),
 ('d-own','room_runtime_inbox','actor_acme_official','conversation',NULL),
 ('d-canceled','room_runtime_inbox','actor_acme_alice','conversation',NULL),
 ('d-notice','room_runtime_inbox','actor_acme_alice','task_terminal_notice',NULL),
 ('d-card-native','room_runtime_inbox','actor_acme_official','conversation',NULL),
 ('d-card-other','room_runtime_inbox','actor_acme_official','conversation',NULL),
 ('d-card-human','room_runtime_inbox','actor_acme_official','conversation',NULL)) seed(id,room,author,kind,card);
INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments,message_kind,card_context_message_id)
SELECT id,'tenant_acme','room_runtime_inbox','actor_acme_alice','decision','[{"type":"text","content":"decision"}]','agent_runtime',card FROM (VALUES
 ('d-runtime-unmentioned','d-card-native'),('d-native','d-card-native'),('d-native-other','d-card-other'),
 ('d-human-decision','d-card-human')) seed(id,card);
UPDATE rooms SET parent_room_id='room_runtime_inbox',root_message_id='d-plain'
 WHERE id='room_disposition_thread' AND tenant_id='tenant_acme';
INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments) VALUES
 ('d-direct-plain','tenant_acme','room_disposition_direct','actor_acme_alice','body','[{"type":"text","content":"body"}]'),
 ('d-direct-own','tenant_acme','room_disposition_direct','actor_acme_official','body','[{"type":"text","content":"body"}]');
INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments,card_context_message_id) VALUES
 ('d-direct-decision','tenant_acme','room_disposition_direct','actor_acme_alice','decision','[{"type":"text","content":"decision"}]','d-direct-own');
UPDATE rooms SET parent_room_id='room_disposition_direct',root_message_id='d-direct-plain'
 WHERE id='room_disposition_direct_thread' AND tenant_id='tenant_acme';
INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments) VALUES
 ('d-thread-plain','tenant_acme','room_disposition_thread','actor_acme_alice','body','[{"type":"text","content":"body"}]'),
 ('d-thread-mention','tenant_acme','room_disposition_thread','actor_acme_alice','body','[{"type":"text","content":"body"}]'),
 ('d-direct-thread-plain','tenant_acme','room_disposition_direct_thread','actor_acme_alice','body','[{"type":"text","content":"body"}]');
INSERT INTO room_events(event_id,tenant_id,room_id,room_seq,event_type,actor_id,resource_id,payload)
SELECT message.id||'-created',message.tenant_id,message.room_id,
 room.next_room_seq+row_number() OVER (PARTITION BY message.room_id ORDER BY message.id),'message.created',message.author_actor_id,message.id,'{}'
FROM messages message JOIN rooms room ON room.id=message.room_id WHERE message.id LIKE 'd-%';
UPDATE rooms room SET next_room_seq=(SELECT max(event.room_seq) FROM room_events event WHERE event.room_id=room.id)
WHERE room.id IN ('room_runtime_inbox','room_disposition_thread','room_disposition_direct','room_disposition_direct_thread');
UPDATE messages message SET room_seq=event.room_seq,mentioned_actor_ids=CASE
 WHEN event.resource_id IN ('d-mention','d-peer-agent-mention-me','d-canceled','d-notice','d-native','d-native-other','d-human-decision','d-thread-mention') THEN ARRAY['actor_acme_official']
 WHEN event.resource_id='d-other-agent-mention' THEN ARRAY['actor_disposition_peer']
 WHEN event.resource_id='d-both-agents-mention' THEN ARRAY['actor_disposition_peer','actor_acme_official']
 WHEN event.resource_id='d-human-only-mention' THEN ARRAY['actor_acme_bob']
 ELSE '{}'::text[] END
FROM room_events event
WHERE event.resource_id=message.id AND event.room_id=message.room_id
 AND event.event_type='message.created' AND event.resource_id LIKE 'd-%';
INSERT INTO room_agent_message_cancellations(tenant_id,room_id,agent_actor_id,message_id)
 VALUES('tenant_acme','room_runtime_inbox','actor_acme_official','d-canceled');
INSERT INTO message_cards(message_id,tenant_id,room_id,decision_owner_actor_id,card_type,intent)
SELECT id,'tenant_acme','room_runtime_inbox','actor_acme_alice','personal_notice','decision_requested'
FROM unnest(ARRAY['d-card-native','d-card-other','d-card-human']) id;
INSERT INTO decisions(id,tenant_id,room_id,message_id,kind,requested_by_actor_id,decider_actor_id,request,view)
SELECT 'decision-'||card,'tenant_acme','room_runtime_inbox',card,'question','actor_acme_official','actor_acme_alice',request,
 '{"prompt":"question","questions":[{"id":"q1","prompt":"Which?","input":"radio","options":[{"id":"o1","label":"Yes"}]}]}' FROM (VALUES
 ('d-card-native',jsonb_build_object('runtime',jsonb_build_object('kind','native_question','context_key',$1::text))),
 ('d-card-other',jsonb_build_object('runtime',jsonb_build_object('kind','native_question','context_key','another-context'))),
 ('d-card-human','{}'::jsonb)) seed(card,request);
INSERT INTO task_meta_messages(id,tenant_id,task_id,agent_actor_id,meta_seq,author_actor_id,body,segments,source)
 VALUES('d-meta','tenant_acme',$2,'actor_acme_official',1,'actor_acme_official','meta','`+mention+`','message');
INSERT INTO task_meta_callbacks(task_id,tenant_id,generation,coordinator_actor_id,coordinator_context_key)
 VALUES($2,'tenant_acme',1,'actor_acme_official',$1);
INSERT INTO task_meta_callback_messages(id,task_id,tenant_id,generation,meta_seq,author_actor_id,body,segments) VALUES
 ('d-callback',$2,'tenant_acme',1,1,'actor_acme_alice','callback','`+mention+`'),
 ('d-callback-own',$2,'tenant_acme',1,2,'actor_acme_official','callback','[]');`,
		pgx.QueryExecModeSimpleProtocol, env.contextKey, taskID); err != nil {
		t.Fatal(err)
	}
	type dispositionCase struct {
		name, context, inbox, message, want string
		mentioned                           bool
	}
	room, thread := "room:"+testRuntimeInboxRoom, "thread:room_disposition_thread"
	direct, directThread := "room:room_disposition_direct", "thread:room_disposition_direct_thread"
	check := func(t *testing.T, cases []dispositionCase) {
		t.Helper()
		for _, c := range cases {
			var context, inbox *string
			if c.context != "" {
				context = &c.context
			}
			if c.inbox != "" {
				inbox = &c.inbox
			}
			var got string
			var mentioned bool
			if err := env.pool.QueryRow(t.Context(), `SELECT disposition,mentioned FROM agent_inbox_message_disposition('tenant_acme','actor_acme_official',$1,$2,$3)`,
				context, inbox, c.message).Scan(&got, &mentioned); err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			if got != c.want || mentioned != c.mentioned {
				t.Errorf("%s: disposition=%s mentioned=%v, want %s %v", c.name, got, mentioned, c.want, c.mentioned)
			}
		}
	}
	check(t, []dispositionCase{
		{"general Agent skips an unmentioned Room message", env.contextKey, room, "d-plain", "skip", false},
		{"a mention notifies", env.contextKey, room, "d-mention", "notify", true},
		{"the Agent's own message is skipped", env.contextKey, room, "d-own", "skip", false},
		{"a Stop for this Agent ignores its mention", env.contextKey, room, "d-canceled", "ignore", true},
		{"a Task notice is not Agent input", env.contextKey, room, "d-notice", "ignore", true},
		{"an unmentioned Runtime decision is not this Agent's", env.contextKey, room, "d-runtime-unmentioned", "ignore", false},
		{"a native answer for this Context", env.contextKey, room, "d-native", "runtime_response", true},
		{"a native answer for another Context", env.contextKey, room, "d-native-other", "ignore", true},
		{"a native answer without a Context", "", "", "d-native", "ignore", true},
		{"an answer to a card without a Runtime request, such as ask-user, mentions the Agent", env.contextKey, room, "d-human-decision", "notify", true},
		{"a mention without a Context", "", "", "d-mention", "notify", true},
		{"an unmentioned Thread message", env.contextKey, thread, "d-thread-plain", "skip", false},
		{"a Thread mention", env.contextKey, thread, "d-thread-mention", "notify", true},
		{"a Human's message in a direct chat mentions its Agent without an @", env.contextKey, direct, "d-direct-plain", "notify", true},
		{"a Human's message in a direct chat's Thread mentions its Agent", env.contextKey, directThread, "d-direct-thread-plain", "notify", true},
		{"the Agent's own message in its direct chat is skipped", env.contextKey, direct, "d-direct-own", "skip", false},
		{"a Human's decision result in a direct chat is not a mention", env.contextKey, direct, "d-direct-decision", "skip", false},
		{"private Meta reaches the alter ego", alter.Context.ContextKey, "meta:actor_acme_official:" + taskID, "d-meta", "notify", true},
		{"private Meta never reaches a Room Context", env.contextKey, "meta:actor_acme_official:" + taskID, "d-meta", "skip", true},
		{"a Task callback notifies its coordinator", env.contextKey, "taskmeta:" + taskID, "d-callback", "notify", true},
		{"an AlterEgo report under the shared identity notifies its coordinator", env.contextKey, "taskmeta:" + taskID, "d-callback-own", "notify", false},
	})
	// A report from a Task a call started is the live voice's to tell while
	// the call holds the Meta; once it ends, the Meta hears its Tasks again.
	insertRuntimeLiveSession(t, env)
	if _, err := env.pool.Exec(t.Context(), `INSERT INTO voice_live_tasks(work_item_id,room_id,owner_actor_id,home_room_id,ordinal,voice_session_id,goal,surface)
 VALUES($1,$2,'actor_acme_alice',$2,1,'voice-handover','Compare prices','workspace')`, taskID, testRuntimeInboxRoom); err != nil {
		t.Fatal(err)
	}
	check(t, []dispositionCase{{"a call's Task report during the call", env.contextKey, "taskmeta:" + taskID, "d-callback", "ignore", true}})
	// Another user's call in the Room does not tell this Task's owner.
	if _, err := env.pool.Exec(t.Context(), `UPDATE voice_live_tasks SET owner_actor_id='actor_acme_bob' WHERE work_item_id=$1`, taskID); err != nil {
		t.Fatal(err)
	}
	check(t, []dispositionCase{{"a Task report during another user's call", env.contextKey, "taskmeta:" + taskID, "d-callback", "notify", true}})
	if _, err := env.pool.Exec(t.Context(), `UPDATE voice_live_tasks SET owner_actor_id='actor_acme_alice' WHERE work_item_id=$1`, taskID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.pool.Exec(t.Context(), `UPDATE voice_sessions SET live_lease_until=clock_timestamp()-interval '1 second' WHERE id='voice-handover'`); err != nil {
		t.Fatal(err)
	}
	check(t, []dispositionCase{{"a call's Task report after the call", env.contextKey, "taskmeta:" + taskID, "d-callback", "notify", true}})
	// A private stream decides only its own Messages.
	var rows int
	if err := env.pool.QueryRow(t.Context(), `SELECT count(*) FROM agent_inbox_message_disposition('tenant_acme','actor_acme_official',$1,$2,'d-mention')`, env.contextKey, "taskmeta:"+taskID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a Room message read through a private stream rows=%d err=%v", rows, err)
	}

	// The option, not the Agent type, decides hearing every message: a General
	// Agent with it on hears as Another Me does.
	if _, err := env.pool.Exec(t.Context(), `UPDATE agent_registrations SET receives_all_messages=true WHERE actor_id='actor_acme_official'`); err != nil {
		t.Fatal(err)
	}
	check(t, []dispositionCase{
		{"a General Agent receiving every message hears an unmentioned Room message", env.contextKey, room, "d-plain", "notify", false},
		{"a General Agent receiving every message skips a message mentioning only another Agent", env.contextKey, room, "d-other-agent-mention", "skip", false},
		{"a General Agent receiving every message hears a message mentioning both it and another Agent", env.contextKey, room, "d-both-agents-mention", "notify", true},
		{"a General Agent receiving every message hears a message mentioning only a Human", env.contextKey, room, "d-human-only-mention", "notify", false},
		{"a General Agent receiving every message skips another Agent's unmentioned reply", env.contextKey, room, "d-peer-agent-reply", "skip", false},
		{"a General Agent receiving every message hears another Agent's explicit mention", env.contextKey, room, "d-peer-agent-mention-me", "notify", true},
		{"a General Agent receiving every message still skips its own message", env.contextKey, room, "d-own", "skip", false},
		{"a General Agent receiving every message skips an unmentioned Thread message", env.contextKey, thread, "d-thread-plain", "skip", false},
	})

	// AnotherMe hears unaddressed Human Room and Task messages, but messages
	// mentioning only other Agent(s), other Agents' unmentioned replies, and
	// unmentioned Thread messages wake only the Agents they mention.
	useAllActionableRuntimeAgent(t, env)
	check(t, []dispositionCase{
		{"AnotherMe hears an unmentioned Room message", env.contextKey, room, "d-plain", "notify", false},
		{"AnotherMe skips a group Room message mentioning only another Agent", env.contextKey, room, "d-other-agent-mention", "skip", false},
		{"AnotherMe hears a group Room message mentioning both it and another Agent", env.contextKey, room, "d-both-agents-mention", "notify", true},
		{"AnotherMe hears a group Room message mentioning only a Human", env.contextKey, room, "d-human-only-mention", "notify", false},
		{"AnotherMe skips another Agent's unmentioned reply", env.contextKey, room, "d-peer-agent-reply", "skip", false},
		{"AnotherMe hears another Agent's explicit mention", env.contextKey, room, "d-peer-agent-mention-me", "notify", true},
		{"AnotherMe still skips its own message", env.contextKey, room, "d-own", "skip", false},
		{"AnotherMe skips an unmentioned Thread message", env.contextKey, thread, "d-thread-plain", "skip", false},
		{"AnotherMe hears a Thread mention", env.contextKey, thread, "d-thread-mention", "notify", true},
		{"AnotherMe hears a mention", env.contextKey, room, "d-mention", "notify", true},
		{"AnotherMe's Human in its direct chat is a mention", env.contextKey, direct, "d-direct-plain", "notify", true},
		{"AnotherMe hears its Human in a direct chat's Thread", env.contextKey, directThread, "d-direct-thread-plain", "notify", true},
		{"AnotherMe skips a decision result in its direct chat", env.contextKey, direct, "d-direct-decision", "skip", false},
	})
}

// TestGroupRoomAnotherMeMentionRouting verifies end-to-end Room message routing
// across HTTP message creation, Agent replies, and trigger-driven Run queueing
// for Another Me alongside specialist Agents in a group Room and in a 1:1 DM.
func TestGroupRoomAnotherMeMentionRouting(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, alice := newAgentRunEnv(t, "http://127.0.0.1:1")
	if _, err := env.pool.Exec(t.Context(), `
		UPDATE agent_registrations
		SET agent_type='anotherme',receives_all_messages=true,represented_human_actor_id='actor_acme_alice'
		WHERE actor_id='actor_acme_official'
	`); err != nil {
		t.Fatal(err)
	}
	const (
		anotherMeActorID       = "actor_acme_official"
		researchAnalystActorID = "actor_research_analyst"
		codeReviewerActorID    = "actor_code_reviewer"
	)
	seedPeerHumanActor(t, env.pool)
	seedPeerAgent(t, env, researchAnalystActorID)
	seedPeerAgent(t, env, codeReviewerActorID)

	groupRoomID := createPrivateRoom(t, env, alice, "Getting Started", "getting-started-routing")
	for _, actorID := range []string{"actor_acme_bob", anotherMeActorID, researchAnalystActorID, codeReviewerActorID} {
		if code, body := putRoomMember(t, env, alice, groupRoomID, actorID, "member"); code != http.StatusOK {
			t.Fatalf("add member %s: %d %s", actorID, code, body)
		}
	}

	status, _, directBody := env.request(alice, http.MethodPost, "/v0/tenants/"+acmeTenant+"/direct-rooms", map[string]any{
		"peer_actor_id": anotherMeActorID,
	}, "")
	if status != http.StatusOK && status != http.StatusCreated {
		t.Fatalf("open direct room: %d %s", status, directBody)
	}
	var directRoom struct {
		ID string `json:"id"`
	}
	decode(t, directBody, &directRoom)

	runtime := agentruntimestate.New(env.pool)
	ensureMeta := func(managementID, roomID string) string {
		t.Helper()
		ensured, err := runtime.EnsureContext(t.Context(), agentruntimestate.EnsureContextInput{
			Ref:             agentruntimestate.ContextRef{Kind: "meta", AgentID: managementID, RoomID: roomID},
			TargetResidency: "active",
		})
		if err != nil {
			t.Fatalf("ensure meta context %s/%s: %v", managementID, roomID, err)
		}
		return ensured.Context.ContextKey
	}
	anotherMeGroupCtx := ensureMeta(acmeOfficialAgentManagementID, groupRoomID)
	researchGroupCtx := ensureMeta("management-"+researchAnalystActorID, groupRoomID)
	reviewerGroupCtx := ensureMeta("management-"+codeReviewerActorID, groupRoomID)
	anotherMeDirectCtx := ensureMeta(acmeOfficialAgentManagementID, directRoom.ID)

	type inputOutcome struct {
		count     int
		mentioned bool
	}
	readOutcome := func(contextKey, messageID string) inputOutcome {
		t.Helper()
		var count int
		var payload json.RawMessage
		if err := env.pool.QueryRow(t.Context(), `
			SELECT count(*), coalesce((array_agg(payload ORDER BY input_sequence))[1], '{}'::jsonb)
			FROM agent_runtime_inputs
			WHERE context_key=$1 AND source_message_id=$2
		`, contextKey, messageID).Scan(&count, &payload); err != nil {
			t.Fatalf("query inputs for %s/%s: %v", contextKey, messageID, err)
		}
		outcome := inputOutcome{count: count}
		if count > 0 {
			var parsed struct {
				Accepted struct {
					Messages []struct {
						Mentioned bool `json:"mentioned"`
					} `json:"messages"`
				} `json:"acceptedNotification"`
			}
			if err := json.Unmarshal(payload, &parsed); err != nil || len(parsed.Accepted.Messages) != 1 {
				t.Fatalf("decode notification payload %s: %v", payload, err)
			}
			outcome.mentioned = parsed.Accepted.Messages[0].Mentioned
		}
		return outcome
	}
	postHuman := func(roomID, key string, segments []map[string]any) string {
		t.Helper()
		var raw strings.Builder
		for _, seg := range segments {
			raw.WriteString(seg["content"].(string))
		}
		code, _, body := env.request(alice, http.MethodPost, "/v0/rooms/"+roomID+"/messages", map[string]any{
			"raw_message": raw.String(),
			"segments":    segments,
		}, key)
		if code != http.StatusCreated {
			t.Fatalf("create human message %s: %d %s", key, code, body)
		}
		var created struct {
			ID string `json:"id"`
		}
		decode(t, body, &created)
		return created.ID
	}

	// Scenario 1: Direct @Another Me mention in group Room wakes only Another Me.
	directMentionID := postHuman(groupRoomID, "routing-direct-anotherme", []map[string]any{
		{"type": "reference", "content": "@Linger", "target": anotherMeActorID, "target_type": "agent"},
		{"type": "text", "content": " summarize our notes."},
	})
	if got := readOutcome(anotherMeGroupCtx, directMentionID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 1 Another Me outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(researchGroupCtx, directMentionID); got.count != 0 {
		t.Fatalf("Scenario 1 Research Analyst outcome=%+v want count=0", got)
	}
	if got := readOutcome(reviewerGroupCtx, directMentionID); got.count != 0 {
		t.Fatalf("Scenario 1 Code Reviewer outcome=%+v want count=0", got)
	}

	// Scenario 2: Mentioning BOTH @Research Analyst and @Another Me wakes both.
	bothMentionID := postHuman(groupRoomID, "routing-both-mentioned", []map[string]any{
		{"type": "reference", "content": "@Research Analyst", "target": researchAnalystActorID, "target_type": "agent"},
		{"type": "text", "content": " "},
		{"type": "reference", "content": "@Linger", "target": anotherMeActorID, "target_type": "agent"},
		{"type": "text", "content": " compare both options."},
	})
	if got := readOutcome(researchGroupCtx, bothMentionID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 2 Research Analyst outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(anotherMeGroupCtx, bothMentionID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 2 Another Me outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(reviewerGroupCtx, bothMentionID); got.count != 0 {
		t.Fatalf("Scenario 2 Code Reviewer outcome=%+v want count=0", got)
	}

	// Scenario 3: Unmentioned group Room message (and Human-only mention) preserves
	// Another Me's default participation without waking specialists.
	unmentionedID := postHuman(groupRoomID, "routing-no-mentions", []map[string]any{
		{"type": "text", "content": "What should we tackle next?"},
	})
	if got := readOutcome(anotherMeGroupCtx, unmentionedID); got.count != 1 || got.mentioned {
		t.Fatalf("Scenario 3 plain message Another Me outcome=%+v want count=1 mentioned=false", got)
	}
	if got := readOutcome(researchGroupCtx, unmentionedID); got.count != 0 {
		t.Fatalf("Scenario 3 plain message Research Analyst outcome=%+v want count=0", got)
	}
	humanOnlyMentionID := postHuman(groupRoomID, "routing-human-only-mention", []map[string]any{
		{"type": "reference", "content": "@Bob", "target": "actor_acme_bob", "target_type": "user"},
		{"type": "text", "content": " can you check the timeline?"},
	})
	if got := readOutcome(anotherMeGroupCtx, humanOnlyMentionID); got.count != 1 || got.mentioned {
		t.Fatalf("Scenario 3 human-only mention Another Me outcome=%+v want count=1 mentioned=false", got)
	}
	if got := readOutcome(researchGroupCtx, humanOnlyMentionID); got.count != 0 {
		t.Fatalf("Scenario 3 human-only mention Research Analyst outcome=%+v want count=0", got)
	}

	// Scenario 4: Explicit @-mention of ONLY another Agent (or multiple other Agents)
	// wakes only the mentioned Agent(s); Another Me is NOT woken on the user's message
	// nor on Research Analyst's subsequent reply.
	onlyResearchID := postHuman(groupRoomID, "routing-only-research", []map[string]any{
		{"type": "reference", "content": "@Research Analyst", "target": researchAnalystActorID, "target_type": "agent"},
		{"type": "text", "content": " Explain RAG in three sentences."},
	})
	if got := readOutcome(researchGroupCtx, onlyResearchID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 4 Research Analyst outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(anotherMeGroupCtx, onlyResearchID); got.count != 0 {
		t.Fatalf("Scenario 4 Another Me must not wake on @Research Analyst message: outcome=%+v", got)
	}
	if got := readOutcome(reviewerGroupCtx, onlyResearchID); got.count != 0 {
		t.Fatalf("Scenario 4 Code Reviewer outcome=%+v want count=0", got)
	}

	multiOtherAgentsID := postHuman(groupRoomID, "routing-multi-other-agents", []map[string]any{
		{"type": "reference", "content": "@Research Analyst", "target": researchAnalystActorID, "target_type": "agent"},
		{"type": "text", "content": " and "},
		{"type": "reference", "content": "@Code Reviewer", "target": codeReviewerActorID, "target_type": "agent"},
		{"type": "text", "content": " review this RFC."},
	})
	if got := readOutcome(researchGroupCtx, multiOtherAgentsID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 4 multi-agent Research Analyst outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(reviewerGroupCtx, multiOtherAgentsID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 4 multi-agent Code Reviewer outcome=%+v want count=1 mentioned=true", got)
	}
	if got := readOutcome(anotherMeGroupCtx, multiOtherAgentsID); got.count != 0 {
		t.Fatalf("Scenario 4 multi-agent Another Me must not wake: outcome=%+v", got)
	}

	// Research Analyst replies in the group Room (plain reply, reply mentioning only
	// the Human, and a reply quoting the user message): none may wake Another Me.
	researchCred, err := agentcredential.New(env.pool).IssueManaged(t.Context(), "management-"+researchAnalystActorID, "routing-test")
	if err != nil {
		t.Fatal(err)
	}
	sendService := newAgentSendService(t, env.pool, agentauth.New(env.pool))
	sendCtx := agentauth.WithTarget(t.Context(), "room", groupRoomID)

	plainReplyInput := agentSendInput("room:"+groupRoomID, "agent-invocation-sha256:"+strings.Repeat("1", 64),
		agentsendmessage.PreparedSegment{Type: "text", Content: "RAG combines retrieval with generation to ground answers in external sources."})
	plainReply, err := sendService.Send(sendCtx, researchCred.AccessToken, plainReplyInput)
	if err != nil || !plainReply.Accepted {
		t.Fatalf("Research Analyst plain reply: %+v err=%v", plainReply, err)
	}
	if got := readOutcome(anotherMeGroupCtx, plainReply.MessageID); got.count != 0 {
		t.Fatalf("Scenario 4 Another Me must not wake on Research Analyst plain reply: outcome=%+v", got)
	}

	replyToUserInput := agentSendInput("room:"+groupRoomID, "agent-invocation-sha256:"+strings.Repeat("2", 64),
		agentsendmessage.PreparedSegment{Type: "reference", Content: "@alice", Target: "actor_acme_alice", TargetType: "user"},
		agentsendmessage.PreparedSegment{Type: "text", Content: " Here is the three-sentence RAG summary."})
	replyToUserInput.SourceMessageID = onlyResearchID
	replyToUser, err := sendService.Send(sendCtx, researchCred.AccessToken, replyToUserInput)
	if err != nil || !replyToUser.Accepted {
		t.Fatalf("Research Analyst human-mention reply: %+v err=%v", replyToUser, err)
	}
	if got := readOutcome(anotherMeGroupCtx, replyToUser.MessageID); got.count != 0 {
		t.Fatalf("Scenario 4 Another Me must not wake on Research Analyst reply to Human: outcome=%+v", got)
	}

	// An explicit Agent-to-AnotherMe mention still wakes Another Me as mentioned.
	handoffInput := agentSendInput("room:"+groupRoomID, "agent-invocation-sha256:"+strings.Repeat("3", 64),
		agentsendmessage.PreparedSegment{Type: "reference", Content: "@Linger", Target: anotherMeActorID, TargetType: "agent"},
		agentsendmessage.PreparedSegment{Type: "text", Content: " Please synthesize this for Alice."})
	handoffReply, err := sendService.Send(sendCtx, researchCred.AccessToken, handoffInput)
	if err != nil || !handoffReply.Accepted {
		t.Fatalf("Research Analyst explicit mention of Another Me: %+v err=%v", handoffReply, err)
	}
	if got := readOutcome(anotherMeGroupCtx, handoffReply.MessageID); got.count != 1 || !got.mentioned {
		t.Fatalf("Agent explicit mention of Another Me outcome=%+v want count=1 mentioned=true", got)
	}

	// Scenario 5: 1:1 DM with Another Me works identically with or without @.
	directPlainID := postHuman(directRoom.ID, "routing-direct-plain", []map[string]any{
		{"type": "text", "content": "Remind me of my afternoon meetings."},
	})
	if got := readOutcome(anotherMeDirectCtx, directPlainID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 5 1:1 DM plain message outcome=%+v want count=1 mentioned=true", got)
	}
	directExplicitID := postHuman(directRoom.ID, "routing-direct-explicit", []map[string]any{
		{"type": "reference", "content": "@Linger", "target": anotherMeActorID, "target_type": "agent"},
		{"type": "text", "content": " Check my inbox."},
	})
	if got := readOutcome(anotherMeDirectCtx, directExplicitID); got.count != 1 || !got.mentioned {
		t.Fatalf("Scenario 5 1:1 DM explicit mention outcome=%+v want count=1 mentioned=true", got)
	}
}
