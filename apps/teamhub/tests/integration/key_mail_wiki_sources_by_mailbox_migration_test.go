//go:build integration_migration_history

package integration_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

// Mail sources two Connections of one mailbox imported merge into one source
// per message keyed by the mailbox. The source that stays is the one in the
// Wiki, then the one written last; the others leave like trashed Documents
// but keep their published rows, so the next refresh removes them.
func TestKeyMailWikiSourcesByMailboxMergesReconnectedMailbox(t *testing.T) {
	ctx := context.Background()
	databaseURL := newEmptyDatabase(t, "mail_mailbox_key")
	db := openMigrationTestDatabase(t, databaseURL)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, os.DirFS(teamHubMigrationDirectory(t)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 874); err != nil {
		t.Fatal(err)
	}
	insertUnifiedDocumentIdentityFixture(t, ctx, db)
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	// m1 and m3 were imported by both Connections; m2 only by the first. The
	// later copy of m3 left the Wiki, so the earlier one stays. orphan's
	// Connection never learned its mailbox.
	if _, err := pool.Exec(ctx, `
		INSERT INTO external_connections(id,account_id,provider,upstream_connection_id,status,identity_label,remote_principal_key) VALUES
			('connection_before','account_document_a','gmail','upstream_before','revoked','a@example.com','gmail:a@example.com'),
			('connection_after','account_document_a','gmail','upstream_after','active','a@example.com','gmail:a@example.com'),
			('connection_unknown','account_document_a','gmail','upstream_unknown','failed',NULL,NULL);
		INSERT INTO personal_wikis(id,tenant_id,owner_actor_id) VALUES('wiki_mail','tenant_document_a','actor_human_a');
		CREATE TEMPORARY TABLE fixture(id text, connection_id text, message text, binding text, written timestamptz);
		INSERT INTO fixture VALUES
			('m1_before','connection_before','message:1','active','2026-11-11 03:47'),
			('m1_after','connection_after','message:1','active','2026-11-11 03:59'),
			('m2_before','connection_before','message:2','active','2026-11-11 03:47'),
			('m3_before','connection_before','message:3','active','2026-11-11 03:47'),
			('m3_after','connection_after','message:3','suspended','2026-11-11 03:59'),
			('orphan','connection_unknown','message:9','active','2026-11-11 03:40');
		INSERT INTO documents(id,tenant_id,title,format,owner_actor_id,owner_actor_kind,creator_actor_id,creator_actor_kind,status)
		SELECT id,'tenant_document_a',id || '.md','markdown','actor_human_a','human','actor_human_a','human','active' FROM fixture;
		INSERT INTO document_versions(id,tenant_id,document_id,version_number,filename,representation_format,media_type,
			size_bytes,sha256,content_object_id,source,created_by_actor_id)
		SELECT 'version_' || id,'tenant_document_a',id,1,id || '.md','markdown','text/markdown',5,repeat('a',64),
			'object_' || id,'ordinary_upload','actor_human_a' FROM fixture;
		UPDATE documents SET current_version_id='version_' || id WHERE id IN (SELECT id FROM fixture);
		INSERT INTO document_texts(document_id,tenant_id,source_kind,source_id,status,markdown,markdown_sha256,search_text)
		SELECT id,'tenant_document_a','file_version','version_' || id,'ready','Hello',repeat('b',64),'Hello' FROM fixture
		ON CONFLICT (document_id) DO UPDATE SET source_kind=EXCLUDED.source_kind,source_id=EXCLUDED.source_id,
			status=EXCLUDED.status,markdown=EXCLUDED.markdown,markdown_sha256=EXCLUDED.markdown_sha256,search_text=EXCLUDED.search_text;
		INSERT INTO document_context_bindings(id,tenant_id,document_id,binding_kind,wiki_id,status)
		SELECT 'binding_' || id,'tenant_document_a',id,'wiki_source','wiki_mail',binding FROM fixture;
		INSERT INTO wiki_source_items(tenant_id,owner_actor_id,source_key,content_sha256,document_id,document_version_id,created_at,updated_at)
		SELECT 'tenant_document_a','actor_human_a','mail:' || connection_id || ':' || message,repeat('a',64),id,'version_' || id,written,written
		FROM fixture;
		INSERT INTO document_wiki_published_sources(wiki_id,tenant_id,document_id,document_version_id)
		SELECT 'wiki_mail','tenant_document_a',id,'version_' || id FROM fixture WHERE id IN ('m1_before','m1_after');
		INSERT INTO document_wiki_unsettled_sources(wiki_id,tenant_id,document_id,document_version_id,tries)
		SELECT 'wiki_mail','tenant_document_a',id,'version_' || id,1 FROM fixture WHERE id IN ('m1_before','m1_after');
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}

	assertMemorySourceRows(t, pool, `SELECT source_key,document_id FROM wiki_source_items ORDER BY source_key`,
		[][]any{
			{"mail:gmail:a@example.com:message:1", "m1_after"},
			{"mail:gmail:a@example.com:message:2", "m2_before"},
			{"mail:gmail:a@example.com:message:3", "m3_before"},
		})
	assertMemorySourceRows(t, pool, `SELECT document.id,document.status,binding.status,binding.access_epoch,count.permission_count
		FROM documents document
		JOIN document_context_bindings binding ON binding.document_id=document.id
		JOIN document_permission_counts count ON count.document_id=document.id
		WHERE document.id IN ('m1_after','m1_before','m2_before','m3_after','m3_before','orphan') ORDER BY document.id`,
		[][]any{
			{"m1_after", "active", "active", int64(1), int64(0)},
			{"m1_before", "trashed", "suspended", int64(2), int64(1)},
			{"m2_before", "active", "active", int64(1), int64(0)},
			{"m3_after", "trashed", "suspended", int64(1), int64(1)},
			{"m3_before", "active", "active", int64(1), int64(0)},
			{"orphan", "trashed", "suspended", int64(2), int64(1)},
		})
	assertMemorySourceRows(t, pool, `SELECT document_id,event_type,actor_id FROM document_events
		WHERE document_id IN ('m1_after','m1_before','m2_before','m3_after','m3_before','orphan') ORDER BY document_id,sequence`,
		[][]any{
			{"m1_before", "document.access_invalidated", "actor_human_a"},
			{"m1_before", "document.trashed", "actor_human_a"},
			{"m1_before", "document.binding_updated", "actor_human_a"},
			{"m3_after", "document.access_invalidated", "actor_human_a"},
			{"m3_after", "document.trashed", "actor_human_a"},
			{"orphan", "document.access_invalidated", "actor_human_a"},
			{"orphan", "document.trashed", "actor_human_a"},
			{"orphan", "document.binding_updated", "actor_human_a"},
		})
	// The removed copy stays published until a refresh removes it; its
	// unsettled try count goes.
	assertMemorySourceRows(t, pool, `SELECT document_id FROM document_wiki_published_sources ORDER BY document_id`,
		[][]any{{"m1_after"}, {"m1_before"}})
	assertMemorySourceRows(t, pool, `SELECT document_id FROM document_wiki_unsettled_sources ORDER BY document_id`,
		[][]any{{"m1_after"}})
	assertMemorySourceRows(t, pool, `SELECT source_id FROM wiki_current_sources ORDER BY source_id`,
		[][]any{{"m1_after"}, {"m2_before"}, {"m3_before"}})
	assertMemorySourceRows(t, pool, `SELECT DISTINCT source FROM wiki_document_verdicts`, [][]any{{"gmail"}})
}
