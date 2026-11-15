-- +goose Up
-- A proactive event wake is admitted either by an app connection grant or by
-- the enrolled Local Computer that observed the event (a herdr agent pane on
-- the owner's machine). Delivery rechecks whichever one admitted it.
ALTER TABLE proactive_pending_wakes ADD COLUMN local_computer_id text;

-- +goose Down
ALTER TABLE proactive_pending_wakes DROP COLUMN local_computer_id;
