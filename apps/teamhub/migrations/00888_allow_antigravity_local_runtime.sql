-- +goose Up
-- An Agent may run on a Computer's Antigravity CLI.
ALTER TABLE agent_registrations DROP CONSTRAINT agent_registrations_placement_check;
ALTER TABLE agent_registrations ADD CONSTRAINT agent_registrations_placement_check CHECK (
    status = 'revoked'
    OR (
        computer_id IS NOT NULL
        AND computer_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
        AND local_runtime_type IS NOT NULL
        AND local_runtime_type = ANY (ARRAY['codex', 'claude', 'pi', 'antigravity'])
        AND workspace_grant_id IS NOT NULL
        AND workspace_grant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    )
);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the Antigravity local runtime is forward-only'; END $$;
-- +goose StatementEnd
