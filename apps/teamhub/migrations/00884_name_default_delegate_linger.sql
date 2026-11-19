-- +goose Up
-- Match the represented Human's generated name so custom names keep their identity.
WITH renamed AS (
    UPDATE actors actor
    SET display_name = 'Linger'
    FROM agent_registrations registration, actors human
    WHERE registration.actor_id = actor.id
      AND registration.tenant_id = actor.tenant_id
      AND registration.agent_type = 'anotherme'
      AND human.id = registration.represented_human_actor_id
      AND human.tenant_id = registration.tenant_id
      AND human.kind = 'human'
      AND actor.kind = 'agent'
      AND actor.display_name = human.display_name || '''s Another Me'
    RETURNING actor.id, actor.tenant_id
)
-- Existing Sessions adopt the new name on their next turn without a Runtime reset.
UPDATE agent_registrations registration
SET configuration_revision = registration.configuration_revision + 1,
    updated_at = now()
FROM renamed
WHERE registration.actor_id = renamed.id
  AND registration.tenant_id = renamed.tenant_id;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the default delegate name is forward-only'; END $$;
-- +goose StatementEnd
