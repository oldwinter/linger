package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// TestProactiveHerdrEventsAreJudgedLikeAppEventsUnderTheirComputer checks that
// a herdr pane state reported by the Human's own Local Computer is admitted by
// that Computer instead of an app grant, then judged like a mail: once per
// pane state a day, only recorded in quiet hours or past the daily limit, and
// dropped once the Computer is removed.
func TestProactiveHerdrEventsAreJudgedLikeAppEventsUnderTheirComputer(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, pool := newConnectedAnotherMeEnv(t, nil)
	roomID := anotherMeRoomID(t, pool, "actor_acme_alice")
	var computerID, agentID string
	if err := pool.QueryRow(t.Context(), `SELECT computer_id FROM local_computers WHERE owner_tenant_id=$1 AND owner_actor_id='actor_acme_alice' AND removed_at IS NULL`, acmeTenant).Scan(&computerID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM agent_registrations WHERE represented_human_actor_id='actor_acme_alice' AND agent_type='anotherme'`).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	judge := func(context.Context, proactive.EventJudgeRequest) (string, error) {
		return "[Proactive event: decide yourself]", nil
	}
	at := func(hour int) func() time.Time {
		return func() time.Time { return time.Date(2026, 11, 13, hour-8, 0, 0, 0, time.UTC) } // Beijing hour
	}
	day := proactive.New(pool, judge, nil).WithClock(at(10))
	night := proactive.New(pool, judge, nil).WithClock(at(1))
	blocked := func(seq int64) proactive.Event {
		return proactive.HerdrEvent(acmeTenant, "actor_acme_alice", proactive.HerdrReport{
			ComputerID: computerID, Kind: proactive.HerdrAgentBlocked, PaneID: "w1:p1", StateChangeSeq: seq, Agent: "codex", Tail: "A or B?",
		})
	}
	wakes := func(where string) int {
		return countRows(t, env, `SELECT count(*) FROM proactive_pending_wakes WHERE room_id=$1 AND local_computer_id=$2 AND connection_grant='null'::jsonb AND `+where, roomID, computerID)
	}

	if outcome, err := day.HandleEvent(t.Context(), blocked(5)); err != nil || outcome.Skipped != "" ||
		wakes(`body LIKE '%herdr answer --pane w1:p1 --state 5 %' AND body NOT LIKE '%do not tell them now%'`) != 1 {
		t.Fatalf("first state=%+v err=%v", outcome, err)
	}
	if outcome, err := day.HandleEvent(t.Context(), blocked(5)); err != nil || outcome.Skipped != "already_judged" || wakes("true") != 1 {
		t.Fatalf("same pane state=%+v err=%v", outcome, err)
	}
	// 01:00: the next question is recorded for the morning, not told.
	if outcome, err := night.HandleEvent(t.Context(), blocked(6)); err != nil || outcome.Skipped != "gated_to_tracking" ||
		wakes(`body LIKE '%do not tell them now%--state 6 %'`) != 1 {
		t.Fatalf("quiet hours=%+v err=%v", outcome, err)
	}
	// Five reminders a day: the four after the first are told, the sixth only recorded.
	for seq := int64(7); seq <= 10; seq++ {
		if outcome, err := day.HandleEvent(t.Context(), blocked(seq)); err != nil || outcome.Skipped != "" {
			t.Fatalf("reminder %d=%+v err=%v", seq, outcome, err)
		}
	}
	if outcome, err := day.HandleEvent(t.Context(), blocked(11)); err != nil || outcome.Skipped != "gated_to_tracking" {
		t.Fatalf("daily limit=%+v err=%v", outcome, err)
	}

	// A report is queued for the Computer's owner from TeamHub's record.
	if err := day.EnqueueHerdrEvent(t.Context(), proactive.HerdrReport{ComputerID: "computer_unknown", Kind: proactive.HerdrAgentBlocked, PaneID: "w1:p1"}); !errors.Is(err, proactive.ErrUnknownComputer) {
		t.Fatalf("unknown Computer: %v", err)
	}
	if err := day.EnqueueHerdrEvent(t.Context(), proactive.HerdrReport{ComputerID: computerID, Kind: proactive.HerdrAgentFinished, PaneID: "w1:p2", StateChangeSeq: 3}); err != nil {
		t.Fatal(err)
	}
	if countRows(t, env, `SELECT count(*) FROM river_job WHERE kind='proactive.event' AND args->'event'->>'computer_id'=$1
		AND args->'event'->>'owner_actor_id'='actor_acme_alice' AND args->'event'->>'grant' IS NULL`, computerID) != 1 {
		t.Fatal("the herdr report was not queued as the owner's event")
	}

	queries := store.New(pool)
	computer := pgtype.Text{String: computerID, Valid: true}
	if ok, err := reminder.WakeAuthorized(t.Context(), queries, reminder.SourceEvent, acmeTenant, "actor_acme_alice", agentID, []byte("null"), computer); err != nil || !ok {
		t.Fatalf("the owner's Computer does not admit its wake: %v %v", ok, err)
	}
	if ok, err := reminder.WakeAuthorized(t.Context(), queries, reminder.SourceEvent, acmeTenant, "actor_acme_bob", agentID, []byte("null"), computer); err != nil || ok {
		t.Fatalf("another Human's wake was admitted by this Computer: %v %v", ok, err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE local_computers SET status='removed', removed_at=now() WHERE computer_id=$1`, computerID); err != nil {
		t.Fatal(err)
	}
	if ok, err := reminder.WakeAuthorized(t.Context(), queries, reminder.SourceEvent, acmeTenant, "actor_acme_alice", agentID, []byte("null"), computer); err != nil || ok {
		t.Fatalf("a removed Computer still admits its wake: %v %v", ok, err)
	}
	if outcome, err := day.HandleEvent(t.Context(), blocked(12)); err != nil || outcome.Skipped != "authorization_revoked" {
		t.Fatalf("removed Computer=%+v err=%v", outcome, err)
	}
}
