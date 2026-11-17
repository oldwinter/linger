//go:build integration_migration_history

package integration_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

// Texts that came from OCR alone are converted before the scanned flag is
// dropped, so a scan stays out of the Wiki and an image has no searchable
// text; SVG and ordinary texts are untouched.
func TestDropScannedDocumentTextsConvertsOCRTexts(t *testing.T) {
	ctx := context.Background()
	databaseURL := newEmptyDatabase(t, "drop_scanned")
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
	if _, err := pool.Exec(ctx, `
		INSERT INTO documents(id,tenant_id,title,format,owner_actor_id,owner_actor_kind,creator_actor_id,creator_actor_kind,status)
		SELECT id,'tenant_document_a',id,'markdown','actor_human_a','human','actor_human_a','human','active'
		FROM (VALUES('ocr_scan'),('ocr_photo'),('ocr_icon'),('ocr_notes')) document(id);
		INSERT INTO document_versions(id,tenant_id,document_id,version_number,filename,representation_format,media_type,
			size_bytes,sha256,content_object_id,source,created_by_actor_id)
		SELECT 'version_' || id,'tenant_document_a',id,1,filename,format,media,1,repeat('a',64),'object_' || id,
			'ordinary_upload','actor_human_a'
		FROM (VALUES('ocr_scan','scan.pdf','pdf','application/pdf'),('ocr_photo','photo.png','png','image/png'),
			('ocr_icon','icon.svg','svg','image/svg+xml'),('ocr_notes','notes.txt','plain_text','text/plain'))
			document(id,filename,format,media);
		UPDATE documents SET current_version_id='version_' || id WHERE id LIKE 'ocr\_%';
		INSERT INTO document_texts(document_id,tenant_id,source_kind,source_id,status,markdown,markdown_sha256,search_text,scanned)
		SELECT id,'tenant_document_a','file_version','version_' || id,'ready',body,repeat('b',64),body,scanned
		FROM (VALUES('ocr_scan','Recognized receipt',true),('ocr_photo','Recognized screenshot',false),
			('ocr_icon','# icon.svg',false),('ocr_notes','Plain notes',false)) document(id,body,scanned)
		ON CONFLICT (document_id) DO UPDATE SET status=EXCLUDED.status,markdown=EXCLUDED.markdown,
			markdown_sha256=EXCLUDED.markdown_sha256,search_text=EXCLUDED.search_text,scanned=EXCLUDED.scanned;
		INSERT INTO personal_wikis(id,tenant_id,owner_actor_id)
		VALUES('wiki_ocr','tenant_document_a','actor_human_a');
		INSERT INTO document_context_bindings(id,tenant_id,document_id,binding_kind,wiki_id,status)
		SELECT 'binding_' || id,'tenant_document_a',id,'wiki_source','wiki_ocr','active'
		FROM (VALUES('ocr_scan'),('ocr_notes')) document(id);
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}

	assertMemorySourceRows(t, pool, `
		SELECT document_id,status,markdown FROM document_texts WHERE document_id LIKE 'ocr\_%' ORDER BY document_id`,
		[][]any{
			{"ocr_icon", "ready", "# icon.svg"},
			{"ocr_notes", "ready", "Plain notes"},
			{"ocr_photo", "unsupported", ""},
			{"ocr_scan", "no_text", ""},
		})
	assertMemorySourceRows(t, pool, `
		SELECT document_id,coalesce(reason,'') FROM wiki_document_verdicts WHERE document_id LIKE 'ocr\_%' ORDER BY document_id`,
		[][]any{{"ocr_notes", ""}, {"ocr_scan", "scanned"}})
}
