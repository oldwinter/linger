package integration_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The migration drops every Outlook snapshot and queues a new one for each
// active Outlook Connection that had one, 30 minutes out so pods on the old
// logic finish rolling first; Gmail snapshots stay.
func TestOutlookMailReimportMigrationResetsOnlyOutlook(t *testing.T) {
	allowParallelIntegrationTest(t)
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, newIntegrationDatabase(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, connection := range []struct{ id, provider, status string }{
		{"reimport-outlook-active", "outlook", "active"},
		{"reimport-outlook-expired", "outlook", "expired"},
		{"reimport-gmail-active", "gmail", "active"},
	} {
		if _, err = pool.Exec(ctx, `INSERT INTO external_connections(id,account_id,provider,upstream_connection_id,status,
				mail_import_status,mail_import_revision,mail_import_tenant_id,mail_import_cursor,mail_import_read,mail_import_provider_calls,mail_synced_until)
			SELECT $1,account_id,$2,'upstream-'||$1,$3,'completed',0,tenant_id,'',1,3,now() FROM actors WHERE id='actor_acme_alice'`,
			connection.id, connection.provider, connection.status); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, `INSERT INTO external_mail_import_documents(connection_id,remote_id,ordinal,document) VALUES($1,'message:1',0,'{}')`, connection.id); err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile(filepath.Join(teamHubMigrationDirectory(t), "00883_reimport_outlook_mail_by_sent_folder.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	for id, wantImport := range map[string]bool{"reimport-outlook-active": false, "reimport-outlook-expired": false, "reimport-gmail-active": true} {
		var hasImport bool
		var documents int
		if err = pool.QueryRow(ctx, `SELECT mail_import_status IS NOT NULL AND mail_synced_until IS NOT NULL,(SELECT count(*) FROM external_mail_import_documents WHERE connection_id=$1) FROM external_connections WHERE id=$1`, id).Scan(&hasImport, &documents); err != nil {
			t.Fatal(err)
		}
		if hasImport != wantImport || (documents == 1) != wantImport {
			t.Fatalf("%s import=%v documents=%d", id, hasImport, documents)
		}
	}
	rows, err := pool.Query(ctx, `SELECT args->>'connection_id',args->>'tenant_id',queue,state='scheduled' AND scheduled_at>=now()+interval '29 minutes' AND scheduled_at<=now()+interval '31 minutes' FROM river_job WHERE kind='external.mail_connection' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var queued []string
	for rows.Next() {
		var connectionID, tenantID, queue string
		var delayed bool
		if err = rows.Scan(&connectionID, &tenantID, &queue, &delayed); err != nil {
			t.Fatal(err)
		}
		if tenantID != acmeTenant || queue != "external" || !delayed {
			t.Fatalf("job tenant=%s queue=%s delayed=%v", tenantID, queue, delayed)
		}
		queued = append(queued, connectionID)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(queued) != 1 || queued[0] != "reimport-outlook-active" {
		t.Fatalf("queued=%v", queued)
	}
}
