package integration_test

import (
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/externalsource"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/jobs"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
)

// runProfileReminder runs the Profile setup reminder for the fixture's Gmail
// now and waits until its attempt has finished or snoozed.
func (f profileSetupFixture) runProfileReminder(t *testing.T) {
	t.Helper()
	tx, err := f.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if err := jobs.InsertTx(t.Context(), tx, externalsource.ProfileSetupReminderArgs{ConnectionID: "connection_onboarding_gmail"},
		&river.InsertOpts{ScheduledAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for countRows(t, f.env, `SELECT count(*) FROM river_job WHERE kind='typedcard.profile_setup_reminder'
		AND state IN ('available','running') OR kind='typedcard.profile_setup_reminder' AND attempted_at IS NULL`) > 0 {
		if time.Now().After(deadline) {
			t.Fatal("Profile setup reminder did not run")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// quiet makes the Room look silent for longer than the quiet window. The
// grants move back with the Messages, so what was granted when each status
// was written stays the same.
func (f profileSetupFixture) quiet(t *testing.T) {
	t.Helper()
	if _, err := f.pool.Exec(t.Context(), `UPDATE messages SET created_at=created_at-interval '10 minutes' WHERE room_id=$1`, f.roomID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE external_connection_agent_grants SET created_at=created_at-interval '10 minutes' WHERE agent_actor_id=$1`, f.agentID); err != nil {
		t.Fatal(err)
	}
}

func (f profileSetupFixture) statuses(t *testing.T) int {
	t.Helper()
	return countRows(t, f.env, `SELECT count(*) FROM messages WHERE room_id=$1 AND message_kind='agent_runtime'`, f.roomID)
}

// A Human who connected an app without finishing setup, for example in
// Settings and then by voice, is reminded once the Room is quiet: AnotherMe
// is woken once to offer the Profile, and the Human's reply carries no second
// status. The setup card itself is left as it is.
func TestAnotherMeProfileSetupReminderWakesAnotherMeOnceWhenQuiet(t *testing.T) {
	allowParallelIntegrationTest(t)
	// Connected Apps list a grant only while Composio is configured.
	f := newProfileSetupFixture(t, newFakeComposio(t).configure)
	_, appsMessageID, _ := f.card(t, typedcard.DecisionKindProfileSetupApps)
	f.grantGmail(t)
	f.quiet(t)
	f.runProfileReminder(t)

	status := f.onboardingStatus(t, appsMessageID)
	// TeamHub sent the reminder on its own; no Human waits on it.
	if status.humanWaiting {
		t.Fatalf("the reminder %s waits on AnotherMe as if a Human had acted", status.id)
	}
	for _, want := range []string{"Setup cards: not finished", "- Gmail alice@example.test, connection connection_onboarding_gmail",
		"no message of theirs comes with this status", "ask whether to start now from what is connected"} {
		if !strings.Contains(status.body, want) {
			t.Fatalf("reminder lacks %q: %s", want, status.body)
		}
	}
	if got := f.disposition(t, status.id); got != "notify" {
		t.Fatalf("reminder disposition=%s want notify", got)
	}
	if got := countRows(t, f.env, `SELECT count(*) FROM decisions WHERE room_id=$1 AND kind='profile_setup_apps' AND status='pending'`, f.roomID); got != 1 {
		t.Fatalf("pending apps cards=%d want 1", got)
	}

	f.runProfileReminder(t)
	reply := f.say(t, "yes, go ahead", "reminder-reply")
	if got := f.statuses(t); got != 1 {
		t.Fatalf("statuses=%d want 1", got)
	}
	if got := f.disposition(t, reply); got != "notify" {
		t.Fatalf("reply disposition=%s want notify", got)
	}
}

// While the Room is in conversation the reminder waits, writing nothing.
func TestAnotherMeProfileSetupReminderWaitsForAQuietRoom(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProfileSetupFixture(t, newFakeComposio(t).configure)
	f.grantGmail(t)
	f.runProfileReminder(t)
	if got := f.statuses(t); got != 0 {
		t.Fatalf("statuses=%d want 0", got)
	}
	if got := countRows(t, f.env, `SELECT count(*) FROM river_job WHERE kind='typedcard.profile_setup_reminder' AND state='scheduled' AND scheduled_at>now()`); got != 1 {
		t.Fatalf("snoozed reminders=%d want 1", got)
	}
}

// A first status written while nothing was connected only told AnotherMe to
// wait, so an app connected afterwards is still reminded about.
func TestAnotherMeProfileSetupReminderFollowsAWaitingStatus(t *testing.T) {
	allowParallelIntegrationTest(t)
	f := newProfileSetupFixture(t, newFakeComposio(t).configure)
	f.say(t, "hello", "reminder-waiting")
	f.grantGmail(t)
	f.quiet(t)
	f.runProfileReminder(t)
	if got := f.statuses(t); got != 2 {
		t.Fatalf("statuses=%d want the waiting status and the reminder", got)
	}
	if got := countRows(t, f.env, `SELECT count(*) FROM messages WHERE room_id=$1 AND message_kind='agent_runtime' AND body LIKE '%has not finished setup%'`, f.roomID); got != 1 {
		t.Fatalf("reminders=%d want 1", got)
	}
}

// No reminder once a Profile is being written, once a status has offered the
// Profile, or once setup is finished.
func TestAnotherMeProfileSetupReminderSkipsAHandledSetup(t *testing.T) {
	allowParallelIntegrationTest(t)
	for name, prepare := range map[string]func(*testing.T, profileSetupFixture){
		"profile being written": func(t *testing.T, f profileSetupFixture) {
			if _, err := f.pool.Exec(t.Context(), `INSERT INTO personal_profile_builds(tenant_id,owner_actor_id,expires_at) VALUES($1,'actor_acme_alice',now()+interval '30 minutes')`, acmeTenant); err != nil {
				t.Fatal(err)
			}
		},
		"profile already offered": func(t *testing.T, f profileSetupFixture) { f.say(t, "hello", "reminder-hello") },
		"setup finished": func(t *testing.T, f profileSetupFixture) {
			f.decideApps(t, "skipped")
			decisionID, _, version := f.card(t, typedcard.DecisionKindProfileSetupSources)
			if status, body := f.decide(f.human, decisionID, version, map[string]any{"decision": "skipped"}, "reminder-finished"); status != 200 {
				t.Fatalf("sources decision status=%d body=%s", status, body)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newProfileSetupFixture(t, newFakeComposio(t).configure)
			f.grantGmail(t)
			prepare(t, f)
			before := f.statuses(t)
			f.quiet(t)
			f.runProfileReminder(t)
			if got := f.statuses(t); got != before {
				t.Fatalf("statuses before=%d after=%d", before, got)
			}
		})
	}
}
