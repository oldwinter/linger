package integration_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
)

// From its direct chat, in a turn its Human's own message started, a Human's
// AnotherMe hands that request to its Context in another Room where both are
// members: TeamHub posts one hidden handoff that wakes it there. Any other
// caller, turn or Room is refused and posts nothing.
func TestAgentRoomHandoffWakesAnotherMeInItsHumansRoom(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, alice, issued, roomID := newAgentCLIIdentity(t)
	status, _, body := env.request(alice, http.MethodPost, "/v0/tenants/"+acmeTenant+"/direct-rooms", map[string]any{"peer_actor_id": "actor_acme_official"}, "")
	if status != http.StatusOK && status != http.StatusCreated {
		t.Fatalf("create direct chat=%d %s", status, body)
	}
	var direct struct {
		ID string `json:"id"`
	}
	decode(t, body, &direct)
	withoutAliceID := createPrivateRoom(t, env, alice, "Room without Alice", "handoff-without-alice")
	if code, body := putRoomMember(t, env, alice, withoutAliceID, "actor_acme_official", "member"); code != http.StatusOK {
		t.Fatalf("add Agent to %s: %d %s", withoutAliceID, code, body)
	}
	if _, err := env.pool.Exec(t.Context(), `DELETE FROM room_members WHERE room_id=$1 AND actor_id='actor_acme_alice'`, withoutAliceID); err != nil {
		t.Fatal(err)
	}
	otherRoomID := createPrivateRoom(t, env, alice, "Other Room with Alice", "handoff-other-room")
	if code, body := putRoomMember(t, env, alice, otherRoomID, "actor_acme_official", "member"); code != http.StatusOK {
		t.Fatalf("add Agent to %s: %d %s", otherRoomID, code, body)
	}

	// A Context runs one Run at a time: a quiet wake's, a reminder about a
	// card still pending, the result of a card Alice answered, then her typed
	// request. Everything but the request is hidden and authored by Alice;
	// only the answered card is something she did.
	const requested, woken, reminded, answered = "run_handoff_requested", "run_handoff_woken", "run_handoff_reminded", "run_handoff_answered"
	handOff := func(contextID, runID, targetRoomID, invocation string) (int, map[string]any) {
		t.Helper()
		return postRoomHandoff(t, env, issued.AccessToken, contextID, runID, map[string]any{
			"invocation_id": "agent-invocation-sha256:" + semanticDigest([]byte("room-handoff-"+invocation)),
			"room_id":       targetRoomID,
			"instruction":   "Plan the December offsite with the travel Agents and tell Alice the result.",
		})
	}
	// A refusal names its reason in an issue the CLI shows the Agent.
	refused := func(name string, code int, want, reason, contextID, runID, targetRoomID, invocation string) {
		t.Helper()
		got, body := handOff(contextID, runID, targetRoomID, invocation)
		envelope, _ := body["error"].(map[string]any)
		issues, _ := envelope["issues"].([]any)
		issue := map[string]any{}
		if len(issues) == 1 {
			issue, _ = issues[0].(map[string]any)
		}
		if got != code || agentProfileErrorCode(body) != want || issue["code"] != reason {
			t.Fatalf("%s=%d %v, want %d %s %s", name, got, body, code, want, reason)
		}
	}
	endRun := func(runID string) {
		t.Helper()
		for _, statement := range []string{
			`DELETE FROM agent_local_run_inputs WHERE run_id=$1`,
			`DELETE FROM agent_runtime_inputs WHERE local_run_id=$1`,
			`DELETE FROM agent_local_runs WHERE run_id=$1`,
		} {
			if _, err := env.pool.Exec(t.Context(), statement, runID); err != nil {
				t.Fatal(err)
			}
		}
	}
	handoffs := func(roomID string) int {
		return countRows(t, env, `SELECT count(*) FROM messages WHERE room_id=$1 AND message_kind='agent_runtime'
			AND body LIKE '%"kind":"room_handoff"%'`, roomID)
	}

	refused("general Agent", http.StatusForbidden, "operation_forbidden", "not_direct_chat", direct.ID, requested, roomID, "general")
	if _, err := env.pool.Exec(t.Context(), `UPDATE agent_registrations SET agent_type='anotherme',represented_human_actor_id='actor_acme_alice' WHERE actor_id='actor_acme_official'`); err != nil {
		t.Fatal(err)
	}
	refused("from a collaboration Room", http.StatusForbidden, "operation_forbidden", "not_direct_chat", otherRoomID, requested, roomID, "collaboration")
	refused("without a Run", http.StatusForbidden, "operation_forbidden", "not_requested_by_human", direct.ID, "", roomID, "no-run")
	seedDirectChatRun(t, env, direct.ID, woken, "message_handoff_wake", "agent_runtime", noCard)
	refused("in a wake's Run", http.StatusForbidden, "operation_forbidden", "not_requested_by_human", direct.ID, woken, roomID, "wake")
	endRun(woken)
	seedDirectChatRun(t, env, direct.ID, reminded, "message_handoff_reminder", "agent_runtime", cardPending)
	refused("in a pending card reminder's Run", http.StatusForbidden, "operation_forbidden", "not_requested_by_human", direct.ID, reminded, roomID, "reminder")
	endRun(reminded)
	if n := handoffs(roomID) + handoffs(withoutAliceID) + handoffs(direct.ID); n != 0 {
		t.Fatalf("refused handoffs persisted: %d", n)
	}

	seedDirectChatRun(t, env, direct.ID, answered, "message_handoff_answer", "agent_runtime", cardDecided)
	if code, body := handOff(direct.ID, answered, roomID, "answered"); code != http.StatusOK || body["accepted"] != true {
		t.Fatalf("handoff after Alice answered a card=%d %v", code, body)
	}
	endRun(answered)
	seedDirectChatRun(t, env, direct.ID, requested, "message_handoff_request", "conversation", noCard)
	refused("in a Run of another Room", http.StatusForbidden, "operation_forbidden", "not_direct_chat", otherRoomID, requested, roomID, "other-run")
	refused("to a Room without the Human", http.StatusForbidden, "forbidden", "room_unavailable", direct.ID, requested, withoutAliceID, "without-alice")
	refused("to the direct chat", http.StatusForbidden, "forbidden", "room_unavailable", direct.ID, requested, direct.ID, "direct")
	if n := handoffs(withoutAliceID) + handoffs(direct.ID); n != 0 {
		t.Fatalf("refused handoffs persisted: %d", n)
	}

	code, first := handOff(direct.ID, requested, roomID, "accepted")
	if code != http.StatusOK || first["accepted"] != true || first["duplicate_request"] != false || first["inbox_id"] != "room:"+roomID {
		t.Fatalf("handoff=%d %v", code, first)
	}
	code, replay := handOff(direct.ID, requested, roomID, "accepted")
	if code != http.StatusOK || replay["duplicate_request"] != true || replay["handoff_id"] != first["handoff_id"] {
		t.Fatalf("handoff replay=%d %v first=%v", code, replay, first)
	}
	var author string
	var mentioned []string
	var text string
	if err := env.pool.QueryRow(t.Context(), `SELECT author_actor_id,mentioned_actor_ids,body FROM messages WHERE id=$1 AND room_id=$2 AND message_kind='agent_runtime' AND human_waiting`,
		first["handoff_id"], roomID).Scan(&author, &mentioned, &text); err != nil {
		t.Fatalf("read handoff: %v", err)
	}
	if author != "actor_acme_alice" || len(mentioned) != 1 || mentioned[0] != "actor_acme_official" ||
		!strings.Contains(text, "Plan the December offsite") || !strings.Contains(text, `"origin_room_id":"`+direct.ID+`"`) {
		t.Fatalf("handoff author=%s mentioned=%v body=%s", author, mentioned, text)
	}
	if n := handoffs(roomID); n != 2 {
		t.Fatalf("handoffs in the Human's Room=%d, want 2", n)
	}
	// The hidden handoff wakes the AnotherMe's Context in that Room.
	disposition := func(agentActorID string) string {
		var value string
		if err := env.pool.QueryRow(t.Context(), `SELECT disposition FROM agent_inbox_message_disposition($1,$2,'',$3,$4)`,
			acmeTenant, agentActorID, "room:"+roomID, first["handoff_id"]).Scan(&value); err != nil {
			t.Fatalf("disposition for %s: %v", agentActorID, err)
		}
		return value
	}
	if got := disposition("actor_acme_official"); got != "notify" {
		t.Fatalf("AnotherMe disposition=%s, want notify", got)
	}
	if n := countRows(t, env, `SELECT count(*) FROM messages WHERE room_id=$1 AND author_actor_id='actor_acme_official'`, roomID); n != 0 {
		t.Fatalf("the direct chat wrote %d messages in the other Room", n)
	}
}

// Decision states of the card a seeded message carries the context of.
const (
	noCard      = ""
	cardDecided = "answered"
	cardPending = "pending"
)

// seedDirectChatRun records a running Run of the fixture Agent's Context in
// the direct chat whose initial input carries one new message of the given
// kind from Alice. With a card state, the message carries the context of a
// question card the Agent posted: one Alice answered, or one still pending,
// which TeamHub's own reminders carry in her name.
func seedDirectChatRun(t *testing.T, env *testEnv, directID, runID, messageID, kind, card string) {
	t.Helper()
	ensured, err := agentruntimestate.New(env.pool).EnsureContext(t.Context(), agentruntimestate.EnsureContextInput{TargetResidency: "active",
		Ref: agentruntimestate.ContextRef{Kind: "meta", AgentID: acmeOfficialAgentManagementID, RoomID: directID},
	})
	if err != nil {
		t.Fatalf("ensure Context: %v", err)
	}
	key := ensured.Context.ContextKey
	cardID := ""
	if card != noCard {
		cardID = messageID + "_card"
		decided := card == cardDecided
		for _, statement := range []struct {
			query string
			args  []any
		}{
			{`INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments,message_kind)
				VALUES($1,$2,$3,'actor_acme_official','Where should we go?','[{"type":"text","content":"Where should we go?"}]'::jsonb,'conversation')`,
				[]any{cardID, acmeTenant, directID}},
			{`INSERT INTO message_cards(message_id,tenant_id,room_id,decision_owner_actor_id,card_type,intent)
				VALUES($1,$2,$3,'actor_acme_alice','personal_notice','decision_requested')`,
				[]any{cardID, acmeTenant, directID}},
			{`INSERT INTO decisions(id,tenant_id,room_id,message_id,kind,requested_by_actor_id,decider_actor_id,
					status,request,view,answer,decided_at,decided_by_actor_id,finished_at)
				VALUES($1,$2,$3,$4,'question','actor_acme_official','actor_acme_alice',
					CASE WHEN $5 THEN 'answered' ELSE 'pending' END,'{}'::jsonb,
					'{"prompt":"Where?","questions":[{"id":"q1","prompt":"Where?","input":"radio","options":[{"id":"o1","label":"Lake"}]}]}'::jsonb,
					CASE WHEN $5 THEN '{"decision":"submit","answers":{"q1":"Lake"}}'::jsonb END,
					CASE WHEN $5 THEN clock_timestamp() END,
					CASE WHEN $5 THEN 'actor_acme_alice' END,
					CASE WHEN $5 THEN clock_timestamp() END)`,
				[]any{"decision_" + cardID, acmeTenant, directID, cardID, decided}},
		} {
			if _, err := env.pool.Exec(t.Context(), statement.query, statement.args...); err != nil {
				t.Fatalf("seed card %s: %v", cardID, err)
			}
		}
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO messages(id,tenant_id,room_id,author_actor_id,body,segments,message_kind,card_context_message_id)
			VALUES($1,$2,$3,'actor_acme_alice','Please plan it','[{"type":"text","content":"Please plan it"}]'::jsonb,$4,NULLIF($5,''))`,
			[]any{messageID, acmeTenant, directID, kind, cardID}},
		{`INSERT INTO agent_local_runs(run_id,context_key,status,started_at,status_room_id) VALUES($1,$2,'running',clock_timestamp(),$3)`,
			[]any{runID, key, directID}},
		{`INSERT INTO agent_runtime_inputs(context_key,input_id,input_sequence,payload,payload_hash,source_kind,source_message_id,source_inbox_id,status,local_run_id)
			VALUES($1,$2,1,jsonb_build_object('invocationMessageIds',jsonb_build_array($3::text)),decode(repeat('00',32),'hex'),'inbox',$3,'room:'||$4,'handled',$5)`,
			[]any{key, "input_" + runID, messageID, directID, runID}},
		{`INSERT INTO agent_local_run_inputs(run_id,context_key,input_id,relation,ordinal) VALUES($1,$2,$3,'initial',0)`,
			[]any{runID, key, "input_" + runID}},
	} {
		if _, err := env.pool.Exec(t.Context(), statement.query, statement.args...); err != nil {
			t.Fatalf("seed direct chat Run %s: %v", runID, err)
		}
	}
}

// postRoomHandoff calls the handoff route as the CLI of runID in the given
// Room Context; an empty runID sends no Run header.
func postRoomHandoff(t *testing.T, env *testEnv, token, contextID, runID string, input map[string]any) (int, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, env.server.URL+"/api/agent/v1/room-handoffs", bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-TeamHub-Context-Kind", "room")
	request.Header.Set("X-TeamHub-Context-Id", contextID)
	if runID != "" {
		request.Header.Set("X-TeamHub-Run-Id", runID)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(response.Body).Decode(&body)
	return response.StatusCode, body
}
