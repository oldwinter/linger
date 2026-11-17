-- +goose Up
-- Quick notes TeamHub writes from a recording's transcript right after its
-- completion message, which shows them under the transcript once written.
ALTER TABLE capture_sessions
  ADD COLUMN quick_notes_state text
    CONSTRAINT capture_sessions_quick_notes_state_check
    CHECK (quick_notes_state IN ('pending', 'ready', 'failed')),
  ADD COLUMN quick_notes jsonb,
  ADD CONSTRAINT capture_sessions_quick_notes_ready_check
    CHECK ((quick_notes_state = 'ready') = (quick_notes IS NOT NULL));

-- +goose Down
ALTER TABLE capture_sessions
  DROP CONSTRAINT capture_sessions_quick_notes_ready_check,
  DROP COLUMN quick_notes,
  DROP COLUMN quick_notes_state;
