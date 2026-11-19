package integration_test

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/migrations"
)

func TestAnotherMeInstructionsMigrationPreservesCustomIdentityAndRuntime(t *testing.T) {
	allowParallelIntegrationTest(t)
	const oldInstructions = "You are Another Me, a private delegate for the Human you represent. Help them organize work, coordinate with other Agents, and act only within explicit TeamHub authority. Never claim to be the Human, never inherit external credentials implicitly, and ask for approval whenever required by product policy."
	data, err := migrations.Files.ReadFile("00885_use_delegate_display_name_in_instructions.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration, _, found := strings.Cut(string(data), "-- +goose Down")
	if !found {
		t.Fatal("migration has no Down boundary")
	}
	for _, test := range []struct {
		name, displayName, instructions string
		general                         bool
	}{
		{name: "default identity", displayName: "Linger", instructions: oldInstructions},
		{name: "custom name", displayName: "Helper", instructions: oldInstructions},
		{name: "custom instructions", displayName: "Helper", instructions: "Coordinate my research safely."},
		{name: "general Agent", displayName: "Researcher", instructions: oldInstructions, general: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			env, _, _ := newAnotherMeEnv(t)
			actorID := connectAnotherMeComputer(t, env, acmeTenant, "actor_acme_alice")
			var template string
			if err := env.pool.QueryRow(t.Context(), `SELECT instructions FROM agent_registrations WHERE actor_id=$1`, actorID).Scan(&template); err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(template, "You are a private delegate for the Human you represent.") {
				t.Fatalf("new Agent template overrides its identity: %q", template)
			}
			if test.general {
				if err := env.pool.QueryRow(t.Context(), `SELECT actor_id FROM agent_registrations WHERE tenant_id=$1 AND agent_type='general' ORDER BY actor_id LIMIT 1`, acmeTenant).Scan(&actorID); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := env.pool.Exec(t.Context(), `UPDATE actors SET display_name=$2 WHERE id=$1`, actorID, test.displayName); err != nil {
				t.Fatal(err)
			}
			if _, err := env.pool.Exec(t.Context(), `UPDATE agent_registrations SET instructions=$2 WHERE actor_id=$1`, actorID, test.instructions); err != nil {
				t.Fatal(err)
			}
			var profileRevision, runtimeRevision int64
			if err := env.pool.QueryRow(t.Context(), `SELECT configuration_revision, runtime_configuration_revision FROM agent_registrations WHERE actor_id=$1`, actorID).Scan(&profileRevision, &runtimeRevision); err != nil {
				t.Fatal(err)
			}
			wantInstructions := test.instructions
			if !test.general && test.instructions == oldInstructions {
				wantInstructions = template
				profileRevision++
			}
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := env.pool.Exec(t.Context(), migration); err != nil {
					t.Fatal(err)
				}
				var name, instructions string
				var gotProfileRevision, gotRuntimeRevision int64
				if err := env.pool.QueryRow(t.Context(), `
					SELECT actor.display_name, registration.instructions, registration.configuration_revision, registration.runtime_configuration_revision
					FROM actors actor JOIN agent_registrations registration ON registration.actor_id=actor.id
					WHERE actor.id=$1
				`, actorID).Scan(&name, &instructions, &gotProfileRevision, &gotRuntimeRevision); err != nil {
					t.Fatal(err)
				}
				if name != test.displayName || instructions != wantInstructions || gotProfileRevision != profileRevision || gotRuntimeRevision != runtimeRevision {
					t.Fatalf("migration attempt %d: name=%q instructions=%q revisions=%d/%d; want %q, %q, %d/%d", attempt+1, name, instructions, gotProfileRevision, gotRuntimeRevision, test.displayName, wantInstructions, profileRevision, runtimeRevision)
				}
			}
		})
	}
}
