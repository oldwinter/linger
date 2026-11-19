package integration_test

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/migrations"
)

func TestDefaultAnotherMeNameMigrationPreservesCustomNamesAndSessions(t *testing.T) {
	allowParallelIntegrationTest(t)
	data, err := migrations.Files.ReadFile("00884_name_default_delegate_linger.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration, _, found := strings.Cut(string(data), "-- +goose Down")
	if !found {
		t.Fatal("migration has no Down boundary")
	}
	for _, test := range []struct {
		name, customName string
	}{
		{name: "generated default"},
		{name: "custom name", customName: "Helper"},
		{name: "custom name with generated suffix", customName: "Work's Another Me"},
	} {
		t.Run(test.name, func(t *testing.T) {
			env, _, _ := newAnotherMeEnv(t)
			actorID := connectAnotherMeComputer(t, env, acmeTenant, "actor_acme_alice")
			name := test.customName
			wantName := name
			var revisionDelta int64
			if name == "" {
				if err := env.pool.QueryRow(t.Context(), `SELECT display_name || '''s Another Me' FROM actors WHERE id='actor_acme_alice'`).Scan(&name); err != nil {
					t.Fatal(err)
				}
				wantName, revisionDelta = "Linger", 1
			}
			if _, err := env.pool.Exec(t.Context(), `UPDATE actors SET display_name=$2 WHERE id=$1`, actorID, name); err != nil {
				t.Fatal(err)
			}
			var profileRevision, runtimeRevision int64
			if err := env.pool.QueryRow(t.Context(), `SELECT configuration_revision, runtime_configuration_revision FROM agent_registrations WHERE actor_id=$1`, actorID).Scan(&profileRevision, &runtimeRevision); err != nil {
				t.Fatal(err)
			}
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := env.pool.Exec(t.Context(), migration); err != nil {
					t.Fatal(err)
				}
				var gotName string
				var gotProfileRevision, gotRuntimeRevision int64
				if err := env.pool.QueryRow(t.Context(), `
					SELECT actor.display_name, registration.configuration_revision, registration.runtime_configuration_revision
					FROM actors actor JOIN agent_registrations registration ON registration.actor_id=actor.id
					WHERE actor.id=$1
				`, actorID).Scan(&gotName, &gotProfileRevision, &gotRuntimeRevision); err != nil {
					t.Fatal(err)
				}
				if gotName != wantName || gotProfileRevision != profileRevision+revisionDelta || gotRuntimeRevision != runtimeRevision {
					t.Fatalf("migration attempt %d: name=%q profile revision=%d runtime revision=%d; want %q, %d, %d", attempt+1, gotName, gotProfileRevision, gotRuntimeRevision, wantName, profileRevision+revisionDelta, runtimeRevision)
				}
			}
		})
	}
}
