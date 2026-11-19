-- +goose Up
-- A recording's card is labelled Meeting summary; older Messages, which
-- the Agent history view reads, still say Quick notes.
UPDATE messages
SET segments = (
        SELECT jsonb_agg(
            CASE WHEN item.segment->>'type' = 'meeting_notes' AND item.segment->>'content' = 'Quick notes'
                 THEN jsonb_set(item.segment, '{content}', '"Meeting summary"')
                 ELSE item.segment END
            ORDER BY item.position)
        FROM jsonb_array_elements(messages.segments) WITH ORDINALITY AS item(segment, position)),
    body = regexp_replace(body, 'Quick notes$', 'Meeting summary')
WHERE segments @> '[{"type": "meeting_notes", "content": "Quick notes"}]';

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the Meeting summary label is forward-only'; END $$;
-- +goose StatementEnd
