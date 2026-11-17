-- +goose Up
-- The Runtime turns a Run's Operations started. Message activities read the
-- native records a Runtime stamps with these IDs, so a turn links even when
-- none of its tool calls does.
ALTER TABLE agent_local_runs
  ADD COLUMN turn_ids text[] NOT NULL DEFAULT '{}'::text[];

-- +goose Down
ALTER TABLE agent_local_runs
  DROP COLUMN turn_ids;
