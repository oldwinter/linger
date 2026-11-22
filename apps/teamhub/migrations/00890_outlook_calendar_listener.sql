-- +goose Up
-- Routine listeners may poll Outlook Calendar alongside Outlook inbox mail.
ALTER TABLE room_routine_listeners DROP CONSTRAINT room_routine_listeners_kind_check;
ALTER TABLE room_routine_listeners ADD CONSTRAINT room_routine_listeners_kind_check CHECK (
    kind = ANY (ARRAY['slack'::text, 'gmail'::text, 'outlook'::text, 'gcal'::text, 'outlook_calendar'::text])
);

-- Add the calendar binding to existing Outlook listener Routines while keeping
-- their inbox delta cursors intact. Running the trigger update and binding
-- insert in one CTE guarantees both touch the exact same Routines.
WITH upgraded AS (
    UPDATE room_reminders r
    SET trigger = r.trigger || jsonb_build_array(
            jsonb_build_object(
                'type', 'outlook_calendar',
                'account', l.connection_id,
                'calendar_id', 'primary',
                'events', jsonb_build_array('created', 'updated', 'cancelled'),
                'poll_interval_seconds', l.poll_interval_seconds
            )
        ),
        updated_at = clock_timestamp()
    FROM room_routine_listeners l
    WHERE l.routine_id = r.id
      AND l.ordinal = 0
      AND l.kind = 'outlook'
      AND r.template_routine_key LIKE 'anotherme_proactive_listener:%'
      AND r.trigger IS NOT NULL
      AND jsonb_array_length(r.trigger) = 1
      AND NOT EXISTS (
          SELECT 1 FROM room_routine_listeners existing
          WHERE existing.routine_id = r.id
            AND (existing.kind = 'outlook_calendar' OR existing.ordinal = 1)
      )
    RETURNING l.tenant_id, l.room_id, l.routine_id, l.connection_id, l.poll_interval_seconds
)
INSERT INTO room_routine_listeners (
    id, tenant_id, room_id, routine_id, ordinal, kind, connection_id,
    poll_cursor, poll_next_at, poll_interval_seconds
)
SELECT
    'lstr_' || md5(u.routine_id || ':outlook_calendar'),
    u.tenant_id,
    u.room_id,
    u.routine_id,
    1,
    'outlook_calendar',
    u.connection_id,
    NULL,
    clock_timestamp(),
    u.poll_interval_seconds
FROM upgraded u;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the Outlook Calendar listener migration is forward-only'; END $$;
-- +goose StatementEnd
