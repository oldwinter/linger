-- +goose Up
-- Store Routine repeat intervals in minutes (10 to 10080, multiples of 10),
-- migrate existing hour-based rows and snapshots once, and index Routine
-- trigger messages for checking whether the previous occurrence finished.

ALTER TABLE room_reminders
    ADD COLUMN interval_minutes integer;

ALTER TABLE room_reminders
    DROP CONSTRAINT room_reminders_cadence_kind_check,
    DROP CONSTRAINT room_reminders_cadence_shape,
    DROP CONSTRAINT room_reminders_interval_hours_check;

UPDATE room_reminders
SET cadence_kind = 'every_n_minutes',
    interval_minutes = interval_hours * 60
WHERE cadence_kind = 'every_n_hours';

ALTER TABLE room_reminders
    DROP COLUMN interval_hours;

ALTER TABLE room_reminders
    ADD CONSTRAINT room_reminders_cadence_kind_check CHECK (
        cadence_kind = ANY (ARRAY['daily'::text, 'weekly'::text, 'every_n_minutes'::text, 'once'::text])
    ),
    ADD CONSTRAINT room_reminders_cadence_shape CHECK (
        ((cadence_kind IS NULL) AND (run_at IS NULL) AND (interval_minutes IS NULL))
        OR (
            ((cadence_kind = 'daily'::text) AND (hour IS NOT NULL) AND (minute IS NOT NULL) AND (weekdays IS NULL) AND (interval_minutes IS NULL) AND (run_at IS NULL))
            OR ((cadence_kind = 'weekly'::text) AND (hour IS NOT NULL) AND (minute IS NOT NULL) AND (interval_minutes IS NULL) AND (run_at IS NULL) AND (
                (weekdays IS NOT NULL) AND (cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7) AND (array_ndims(weekdays) = 1) AND (array_position(weekdays, NULL::text) IS NULL) AND (weekdays <@ ARRAY['monday'::text, 'tuesday'::text, 'wednesday'::text, 'thursday'::text, 'friday'::text, 'saturday'::text, 'sunday'::text])
            ))
            OR ((cadence_kind = 'every_n_minutes'::text) AND (interval_minutes IS NOT NULL) AND (hour IS NULL) AND (minute IS NULL) AND (weekdays IS NULL) AND (run_at IS NULL))
            OR ((cadence_kind = 'once'::text) AND (run_at IS NOT NULL) AND (hour IS NULL) AND (minute IS NULL) AND (weekdays IS NULL) AND (interval_minutes IS NULL))
        )
    ),
    ADD CONSTRAINT room_reminders_interval_minutes_check CHECK (
        (interval_minutes IS NULL)
        OR ((interval_minutes >= 10) AND (interval_minutes <= 10080) AND ((interval_minutes % 10) = 0))
    );

UPDATE agent_templates
SET routines = (
    SELECT coalesce(jsonb_agg(
        CASE
            WHEN elem->'cadence'->>'kind' = 'every_n_hours' THEN
                jsonb_set(
                    elem,
                    '{cadence}',
                    ((elem->'cadence') - 'interval_hours')
                        || jsonb_build_object(
                            'kind', 'every_n_minutes',
                            'interval_minutes', ((elem->'cadence'->>'interval_hours')::integer * 60)
                        )
                )
            ELSE elem
        END
        ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(routines) WITH ORDINALITY AS t(elem, ord)
)
WHERE routines @> '[{"cadence":{"kind":"every_n_hours"}}]'::jsonb;

UPDATE agent_registrations
SET template_routines = (
    SELECT coalesce(jsonb_agg(
        CASE
            WHEN elem->'cadence'->>'kind' = 'every_n_hours' THEN
                jsonb_set(
                    elem,
                    '{cadence}',
                    ((elem->'cadence') - 'interval_hours')
                        || jsonb_build_object(
                            'kind', 'every_n_minutes',
                            'interval_minutes', ((elem->'cadence'->>'interval_hours')::integer * 60)
                        )
                )
            ELSE elem
        END
        ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(template_routines) WITH ORDINALITY AS t(elem, ord)
)
WHERE template_routines IS NOT NULL
  AND template_routines @> '[{"cadence":{"kind":"every_n_hours"}}]'::jsonb;

UPDATE command_replays
SET response_body = convert_to((
    jsonb_set(
        convert_from(response_body, 'UTF8')::jsonb,
        '{cadence}',
        ((convert_from(response_body, 'UTF8')::jsonb->'cadence') - 'interval_hours')
            || jsonb_build_object(
                'kind', 'every_n_minutes',
                'interval_minutes', (((convert_from(response_body, 'UTF8')::jsonb->'cadence'->>'interval_hours')::integer) * 60)
            )
    )
)::text, 'UTF8')
WHERE state = 'completed'
  AND (
      operation LIKE 'createRoutine:%'
      OR operation LIKE 'updateRoutine:%'
      OR operation LIKE 'runRoutine:%'
      OR operation LIKE 'deleteRoutine:%'
  )
  AND response_body IS NOT NULL
  AND octet_length(response_body) > 0
  AND convert_from(response_body, 'UTF8')::jsonb->'cadence'->>'kind' = 'every_n_hours';

CREATE INDEX messages_fired_routine_idx
    ON public.messages USING btree (room_id, fired_routine_id, created_at DESC, id DESC)
    WHERE (fired_routine_id IS NOT NULL);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'routine interval minutes migration is forward-only';
END $$;
-- +goose StatementEnd
