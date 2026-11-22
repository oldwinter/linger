//go:build integration_migration_history

package integration_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

// Existing Outlook proactive listener Routines gain an ordinal-1
// outlook_calendar spec and binding while keeping their live inbox delta cursor
// intact; Gmail listeners and Routines whose trigger already has multiple
// entries are left untouched.
func TestOutlookCalendarListenerMigrationUpgradesSingleSpecOutlookRoutines(t *testing.T) {
	ctx := context.Background()
	databaseURL := newEmptyDatabase(t, "outlook_cal_listener")
	db := openMigrationTestDatabase(t, databaseURL)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, os.DirFS(teamHubMigrationDirectory(t)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 885); err != nil {
		t.Fatal(err)
	}
	insertUnifiedDocumentIdentityFixture(t, ctx, db)
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	inboxCursor := `{"v":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=inbox1","channels":{"since":"2026-10-28T00:00:00Z"}}`
	if _, err := pool.Exec(ctx, `
		INSERT INTO rooms(id,tenant_id,name,created_by_actor_id)
		VALUES('room_outlook_mig','tenant_document_a','Direct','actor_human_a');

		INSERT INTO room_reminders(
			id,tenant_id,room_id,created_by_actor_id,name,instruction,mention_actor_id,
			timezone,enabled,template_agent_actor_id,template_routine_key,trigger
		) VALUES
			('routine_outlook_single','tenant_document_a','room_outlook_mig','actor_agent_a',
			 'Outlook inbox watch','Judge events','actor_agent_a','UTC',true,
			 'actor_agent_a','anotherme_proactive_listener:conn_outlook',
			 '[{"type":"outlook","account":"conn_outlook","poll_interval_seconds":600}]'::jsonb),
			('routine_gmail_single','tenant_document_a','room_outlook_mig','actor_agent_a',
			 'Gmail inbox watch','Judge events','actor_agent_a','UTC',true,
			 'actor_agent_a','anotherme_proactive_listener:conn_gmail',
			 '[{"type":"gmail","account":"conn_gmail","poll_interval_seconds":600}]'::jsonb),
			('routine_outlook_multi','tenant_document_a','room_outlook_mig','actor_agent_a',
			 'Multi trigger','Judge events','actor_agent_a','UTC',true,
			 'actor_agent_a','anotherme_proactive_listener:conn_outlook_multi',
			 '[{"type":"outlook","account":"conn_outlook_multi","poll_interval_seconds":600},{"type":"gmail","account":"conn_gmail","poll_interval_seconds":600}]'::jsonb);

		INSERT INTO room_routine_listeners(
			id,tenant_id,room_id,routine_id,ordinal,kind,connection_id,poll_cursor,poll_next_at,poll_interval_seconds
		) VALUES
			('lstr_00000000000000000000000000000001','tenant_document_a','room_outlook_mig','routine_outlook_single',
			 0,'outlook','conn_outlook',$1,now(),600),
			('lstr_00000000000000000000000000000002','tenant_document_a','room_outlook_mig','routine_gmail_single',
			 0,'gmail','conn_gmail','{"v":"100"}',now(),600),
			('lstr_00000000000000000000000000000003','tenant_document_a','room_outlook_mig','routine_outlook_multi',
			 0,'outlook','conn_outlook_multi',$1,now(),600);
	`, inboxCursor); err != nil {
		t.Fatal(err)
	}

	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}

	var rawTrigger []byte
	if err := pool.QueryRow(ctx, `SELECT trigger FROM room_reminders WHERE id='routine_outlook_single'`).Scan(&rawTrigger); err != nil {
		t.Fatal(err)
	}
	var specs []reminder.ListenerSpec
	if err := json.Unmarshal(rawTrigger, &specs); err != nil {
		t.Fatal(err)
	}
	if len(specs) != 2 || specs[0].Type != reminder.ListenerOutlook ||
		specs[1].Type != reminder.ListenerOutlookCalendar ||
		specs[1].Account != "conn_outlook" ||
		specs[1].CalendarID != "primary" ||
		specs[1].PollIntervalSeconds != 600 ||
		len(specs[1].Events) != 3 {
		t.Fatalf("upgraded trigger=%+v", specs)
	}

	var inboxAfter pgtype.Text
	if err := pool.QueryRow(ctx, `SELECT poll_cursor FROM room_routine_listeners WHERE routine_id='routine_outlook_single' AND ordinal=0`).Scan(&inboxAfter); err != nil {
		t.Fatal(err)
	}
	if !inboxAfter.Valid || inboxAfter.String != inboxCursor {
		t.Fatalf("inbox cursor changed: got %+v, want %q", inboxAfter, inboxCursor)
	}

	var calKind, calConn string
	var calCursor pgtype.Text
	var calInterval int32
	if err := pool.QueryRow(ctx, `SELECT kind,connection_id,poll_cursor,poll_interval_seconds FROM room_routine_listeners WHERE routine_id='routine_outlook_single' AND ordinal=1`).Scan(&calKind, &calConn, &calCursor, &calInterval); err != nil {
		t.Fatal(err)
	}
	if calKind != reminder.ListenerOutlookCalendar || calConn != "conn_outlook" || calCursor.Valid || calInterval != 600 {
		t.Fatalf("calendar binding kind=%q conn=%q cursor=%+v interval=%d", calKind, calConn, calCursor, calInterval)
	}

	for _, untouched := range []struct {
		routineID   string
		wantTrigger int
	}{
		{"routine_gmail_single", 1},
		{"routine_outlook_multi", 2},
	} {
		var triggerLen, bindingCount int
		if err := pool.QueryRow(ctx, `
			SELECT jsonb_array_length(r.trigger),
			       (SELECT count(*) FROM room_routine_listeners l WHERE l.routine_id=r.id)
			FROM room_reminders r WHERE r.id=$1
		`, untouched.routineID).Scan(&triggerLen, &bindingCount); err != nil {
			t.Fatal(err)
		}
		if triggerLen != untouched.wantTrigger || bindingCount != 1 {
			t.Fatalf("%s modified: triggerLen=%d bindings=%d", untouched.routineID, triggerLen, bindingCount)
		}
	}
}
