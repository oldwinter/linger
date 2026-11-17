-- +goose Up
-- A Task that AnotherMe starts during a proactive wake or a Routine that
-- serves a Tracking Item is quiet: it keeps its origin Room but stays out of
-- the running-Task indicator, and its report asks for one reminder instead of
-- an announcement.
ALTER TABLE work_items
  ADD COLUMN quiet boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE work_items
  DROP COLUMN quiet;
