//go:build integration_migration_history

package integration_test

import (
	"os"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/demodata"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/platform/migrations"
)

func TestForkSchema869UpgradesToCurrentMigrations(t *testing.T) {
	ctx := t.Context()
	databaseURL := newEmptyDatabase(t, "fork_869")
	db := openMigrationTestDatabase(t, databaseURL)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, os.DirFS(teamHubMigrationDirectory(t)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 869); err != nil {
		t.Fatalf("prepare fork schema at version 869: %v", err)
	}
	if err := demodata.SeedIdentities(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	rules := `[{"id":"pr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","text":"Prepare a draft before a deadline.","status":"active","pinned":true,"source":"human","mandate":"create_and_delegate"}]`
	if _, err := db.ExecContext(ctx, `
		INSERT INTO proactive_guidelines(tenant_id,owner_actor_id,version,rules,deleted_rules,clues)
		VALUES('tenant_acme','actor_acme_alice',1,$1::jsonb,'[]','[]')
	`, rules); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO skills(skill_id,owner_kind,name,default_agent_types,access_scope)
		VALUES('simplexai_holistic_context','platform','holistic-context','{anotherme,general}','platform'),
		      ('simplexai_herdr','platform','herdr','{general}','platform');
		INSERT INTO skill_manifests(manifest_id,skill_id,manifest_version,description,config_schema,content_hash,file_count,size_bytes)
		SELECT 'manifest_' || name,skill_id,'1.0.0','Migration fixture','{}',
		       sha256(convert_to('teamhub.skill-package.v1','UTF8') || decode('00','hex') ||
		              int8send(8::bigint) || convert_to('SKILL.md','UTF8') ||
		              int8send(1::bigint) || decode(repeat('31',32),'hex')),1,1
		FROM skills;
		UPDATE skill_manifests SET files=jsonb_build_array(jsonb_build_object(
		    'path','SKILL.md','media_type','text/markdown','size_bytes',1,
		    'sha256',repeat('31',32),'object_key',skill_id || '/SKILL.md'));
		UPDATE skill_manifests SET package_state='sealed',sealed_at=now();
		UPDATE skills SET latest_manifest_id='manifest_' || name;
		INSERT INTO agent_skill_bindings(id,tenant_id,agent_actor_id,skill_id,manifest_version,enabled,config,binding_version)
		SELECT 'binding_' || name,'tenant_acme','actor_acme_official',skill_id,'1.0.0',true,'{}',7
		FROM skills;
	`); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(ctx, databaseURL); err != nil {
		t.Fatalf("upgrade fork schema: %v", err)
	}
	if err := migrations.Up(ctx, databaseURL); err != nil {
		t.Fatalf("repeat migration of current fork schema: %v", err)
	}
	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil || version < 878 {
		t.Fatalf("upgraded version=%d error=%v", version, err)
	}
	var preserved bool
	if err := db.QueryRowContext(ctx, `
		SELECT rules=$1::jsonb AND
		       proactive_mandate_in_force(tenant_id,owner_actor_id,'pr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','create_and_delegate')
		FROM proactive_guidelines WHERE tenant_id='tenant_acme' AND owner_actor_id='actor_acme_alice'
	`, rules).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("fork rules and mandate preserved=%v error=%v", preserved, err)
	}
	var schemaReady bool
	if err := db.QueryRowContext(ctx, `
		SELECT to_regclass('public.message_pins') IS NOT NULL
		   AND to_regclass('public.local_computer_model_snapshots') IS NOT NULL
		   AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND
		        (table_name,column_name) IN (
		          ('proactive_pending_wakes','local_computer_id'),
		          ('capture_sessions','quick_notes_state'),
		          ('capture_sessions','quick_notes'),
		          ('agent_local_runs','turn_ids'),
		          ('work_items','quiet'),
		          ('voice_sessions','next_media_epoch'))) = 6
		   AND NOT EXISTS(SELECT 1 FROM information_schema.columns
		                  WHERE table_schema='public' AND table_name='document_texts' AND column_name='scanned')
	`).Scan(&schemaReady); err != nil || !schemaReady {
		t.Fatalf("combined fork and upstream schema ready=%v error=%v", schemaReady, err)
	}
	for skillID, wantState := range map[string]string{"simplexai_holistic_context": "revoked", "simplexai_herdr": "active"} {
		var state string
		if err := db.QueryRowContext(ctx, `SELECT state FROM skill_manifests WHERE skill_id=$1`, skillID).Scan(&state); err != nil || state != wantState {
			t.Fatalf("Skill %s state=%q want=%q error=%v", skillID, state, wantState, err)
		}
	}
	var retired, controlPreserved bool
	if err := db.QueryRowContext(ctx, `
		SELECT cardinality(skill.default_agent_types)=0
		   AND NOT binding.enabled AND binding.deleted_at IS NOT NULL AND binding.binding_version=8
		FROM skills skill JOIN agent_skill_bindings binding USING(skill_id)
		WHERE skill.skill_id='simplexai_holistic_context' AND binding.agent_actor_id='actor_acme_official'
	`).Scan(&retired); err != nil || !retired {
		t.Fatalf("holistic-context defaults and binding retired=%v error=%v", retired, err)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT skill.default_agent_types=ARRAY['general']::text[]
		   AND binding.enabled AND binding.deleted_at IS NULL AND binding.binding_version=7
		FROM skills skill JOIN agent_skill_bindings binding USING(skill_id)
		WHERE skill.skill_id='simplexai_herdr' AND binding.agent_actor_id='actor_acme_official'
	`).Scan(&controlPreserved); err != nil || !controlPreserved {
		t.Fatalf("Herdr defaults and binding preserved=%v error=%v", controlPreserved, err)
	}
}
