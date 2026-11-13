package integration_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
)

// herdrDeliveries records what TeamHub would type into a pane.
type herdrDeliveries struct {
	mu    sync.Mutex
	calls []typedcard.HerdrDelivery
}

func (d *herdrDeliveries) deliver(_ context.Context, delivery typedcard.HerdrDelivery) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls = append(d.calls, delivery)
	return typedcard.HerdrAnswerSent
}

func (d *herdrDeliveries) recorded() []typedcard.HerdrDelivery {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]typedcard.HerdrDelivery(nil), d.calls...)
}

// TestHerdrAnswerReachesAPaneOnlyFromItsOwnersCard checks that an Agent can
// put nothing into a herdr pane itself: it can only ask the Computer's owner
// with a card bound to a pane state the Computer reported, TeamHub types
// exactly the owner's answer into that pane state, and a card is delivered at
// most once, a run that stopped midway included. A decision.run retry is
// RunDecision again.
func TestHerdrAnswerReachesAPaneOnlyFromItsOwnersCard(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, alice, issued, roomID := newAgentCLIIdentity(t)
	// The decision.run job runs this, as the app's worker would.
	computers := &herdrDeliveries{}
	cards := typedcard.New(env.pool)
	cards.SetHerdrDeliverer(computers.deliver)
	run := func(decisionID string) {
		t.Helper()
		if _, err := cards.RunDecision(t.Context(), decisionID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := env.pool.Exec(t.Context(), `UPDATE agent_registrations SET agent_type='anotherme',represented_human_actor_id='actor_acme_alice',
 user_artifact_owner_actor_id='actor_acme_alice' WHERE actor_id='actor_acme_official'`); err != nil {
		t.Fatal(err)
	}
	var computerID string
	if err := env.pool.QueryRow(t.Context(), `SELECT computer_id FROM agent_registrations WHERE actor_id='actor_acme_official'`).Scan(&computerID); err != nil {
		t.Fatal(err)
	}
	// The Computer reported pane w1:p1 blocked at state 5; that event was judged.
	matter := func(seq int64) string {
		event := proactive.HerdrEvent("tenant_acme", "actor_acme_alice", proactive.HerdrReport{ComputerID: computerID, Kind: proactive.HerdrAgentBlocked, PaneID: "w1:p1", StateChangeSeq: seq})
		return event.Source + "\x00" + event.ExternalID + "\x00" + event.State
	}
	if _, err := env.pool.Exec(t.Context(), `INSERT INTO proactive_potential_items(id,tenant_id,owner_actor_id,content,source,source_key,reminded)
 VALUES('ppi_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','tenant_acme','actor_acme_alice','A coding agent waits','event',$1,true)`, proactive.SourceKey("event", matter(5), proactive.Day(time.Now()))); err != nil {
		t.Fatal(err)
	}
	ask := func(pane string, seq int, options ...string) (int, string) {
		t.Helper()
		status, body := postAgentInRoom(t, env, issued.AccessToken, roomID, "/api/agent/v1/computer/herdr/ask", map[string]any{
			"pane_id": pane, "state_change_seq": seq, "question": "Use A or B?", "options": options,
		})
		return status, string(body)
	}
	type card struct {
		InteractionID string `json:"interaction_id"`
		MessageID     string `json:"message_id"`
	}

	// No Agent path types text into a pane.
	if status, body := postAgentInRoom(t, env, issued.AccessToken, roomID, "/api/agent/v1/computer/herdr/answer", map[string]any{
		"pane_id": "w1:p1", "state_change_seq": 5, "text": "yes",
	}); status != http.StatusNotFound {
		t.Fatalf("free-text answer path: %d %s", status, body)
	}
	for _, unreported := range [][2]any{{"w1:p1", 6}, {"w1:p2", 5}} {
		if status, body := ask(unreported[0].(string), unreported[1].(int), "A"); status != http.StatusConflict {
			t.Fatalf("card for unreported pane state %v: %d %s", unreported, status, body)
		}
	}
	if status, body := ask("w1:p1", 5, "A", "B\nrm -rf ~"); status != http.StatusBadRequest {
		t.Fatalf("choice with a line break: %d %s", status, body)
	}
	status, body := ask("w1:p1", 5, "A", "B")
	var first card
	decode(t, []byte(body), &first)
	if status != http.StatusOK || first.InteractionID == "" {
		t.Fatalf("ask: %d %s", status, body)
	}
	if status, body := ask("w1:p1", 5, "A", "B"); status != http.StatusOK || !strings.Contains(body, first.InteractionID) {
		t.Fatalf("a second card for the same pane state: %d %s", status, body)
	}
	if got := countRows(t, env, `SELECT count(*) FROM decisions WHERE id=$1 AND kind='question' AND decider_actor_id='actor_acme_alice'
 AND request->'herdr'->>'computer_id'=$2 AND request->'herdr'->>'pane_id'='w1:p1' AND request->'herdr'->>'state_change_seq'='5'`, first.InteractionID, computerID); got != 1 {
		t.Fatal("the card is not bound to the reported pane state")
	}
	run(first.InteractionID)
	if calls := computers.recorded(); len(calls) != 0 {
		t.Fatalf("an unanswered card reached the pane: %+v", calls)
	}

	// Only the Computer's owner answers the card.
	bob := seedPeerHuman(t, env)
	if code, body := putRoomMember(t, env, alice, roomID, "actor_acme_bob", "member"); code != http.StatusOK {
		t.Fatalf("add bob: %d %s", code, body)
	}
	answer := map[string]any{"expected_version": 1, "decision": "submit", "answers": map[string]any{"answer": "choice_2"}}
	if code, _, body := env.request(bob, http.MethodPost, "/v0/decisions/"+first.InteractionID, answer, "herdr-bob-"+first.InteractionID); code != http.StatusForbidden {
		t.Fatalf("bob answered the owner's card: %d %s", code, body)
	}
	if calls := computers.recorded(); len(calls) != 0 {
		t.Fatalf("a refused answer reached the pane: %+v", calls)
	}
	if code, _, body := env.request(alice, http.MethodPost, "/v0/decisions/"+first.InteractionID, answer, "herdr-alice-"+first.InteractionID); code != http.StatusOK {
		t.Fatalf("owner answer: %d %s", code, body)
	}
	if got := countRows(t, env, `SELECT count(*) FROM river_job WHERE kind='decision.run' AND args->>'decision_id'=$1`, first.InteractionID); got != 1 {
		t.Fatalf("the answer queued %d deliveries", got)
	}
	run(first.InteractionID)
	assertHerdrResult(t, env, first.InteractionID, "sent")
	calls := computers.recorded()
	if len(calls) != 1 || calls[0].Target.ComputerID != computerID || calls[0].Target.PaneID != "w1:p1" || calls[0].Target.StateChangeSeq != 5 ||
		calls[0].OwnerActorID != "actor_acme_alice" || calls[0].AgentManagementID != issued.AgentID || calls[0].Text != "B" {
		t.Fatalf("delivered=%+v", calls)
	}
	var handoff string
	if err := env.pool.QueryRow(t.Context(), `SELECT body FROM messages WHERE card_context_message_id=$1 AND message_kind='agent_runtime'`, first.MessageID).Scan(&handoff); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(handoff, "Use A or B? → B") || !strings.Contains(handoff, "herdr pane w1:p1 (state 5): sent") {
		t.Fatalf("handoff=%q", handoff)
	}
	// A retried run returns the recorded delivery and never sends again.
	run(first.InteractionID)
	if calls := computers.recorded(); len(calls) != 1 {
		t.Fatalf("a retried run sent again: %+v", calls)
	}
	if got := countRows(t, env, `SELECT count(*) FROM messages WHERE card_context_message_id=$1 AND message_kind='agent_runtime'`, first.MessageID); got != 1 {
		t.Fatalf("the Agent heard the delivery %d times", got)
	}

	// A run that stopped after marking the answer sending may have typed it:
	// it ends unknown and is not sent again.
	if _, err := env.pool.Exec(t.Context(), `INSERT INTO proactive_potential_items(id,tenant_id,owner_actor_id,content,source,source_key,reminded)
 VALUES('ppi_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','tenant_acme','actor_acme_alice','A coding agent waits','event',$1,true)`,
		proactive.SourceKey("event", matter(7), proactive.Day(time.Now()))); err != nil {
		t.Fatal(err)
	}
	status, body = ask("w1:p1", 7, "A")
	var stopped card
	decode(t, []byte(body), &stopped)
	if status != http.StatusOK {
		t.Fatalf("ask: %d %s", status, body)
	}
	if _, err := env.pool.Exec(t.Context(), `UPDATE decisions SET status='answered', decided_at=clock_timestamp(), finished_at=clock_timestamp(),
 decided_by_actor_id='actor_acme_alice', answer='{"decision":"submit","answers":{"answer":"choice_1"}}',
 result='{"outcome":"Sending","data":{"herdr":"sending"}}' WHERE id=$1`, stopped.InteractionID); err != nil {
		t.Fatal(err)
	}
	run(stopped.InteractionID)
	assertHerdrResult(t, env, stopped.InteractionID, "outcome_unknown")
	if calls := computers.recorded(); len(calls) != 1 {
		t.Fatalf("a stopped delivery was sent again: %+v", calls)
	}

}

func assertHerdrResult(t *testing.T, env *testEnv, decisionID, want string) {
	t.Helper()
	if countRows(t, env, `SELECT count(*) FROM decisions WHERE id=$1 AND result->'data'->>'herdr'=$2`, decisionID, want) != 1 {
		t.Fatalf("decision %s did not record herdr %s", decisionID, want)
	}
}
