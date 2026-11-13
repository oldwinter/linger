-- name: GetRunProactiveWakeSource :one
-- The source of the delivered proactive wake that started this Run in this
-- Room, if one did. A Room notification input names the Messages it carries
-- in payload invocationMessageIds. A wake steered into a Run already answering
-- the Human does not make that Run proactive. Mixed initial inputs and any
-- Human input already attached when this Message is sent keep it ordinary.
SELECT wake.source FROM agent_local_run_inputs relation
JOIN agent_runtime_inputs input
  ON input.context_key=relation.context_key AND input.input_id=relation.input_id
JOIN proactive_pending_wakes wake
  ON wake.room_id=sqlc.arg(room_id)::text AND wake.message_id IS NOT NULL
 AND (input.source_message_id=wake.message_id
      OR jsonb_typeof(input.payload->'invocationMessageIds')='array'
         AND input.payload->'invocationMessageIds' @> to_jsonb(wake.message_id))
WHERE relation.run_id=sqlc.arg(run_id)::text AND relation.relation='initial'
  AND wake.delivered_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM agent_local_run_inputs human_relation
    JOIN agent_runtime_inputs human_input
      ON human_input.context_key=human_relation.context_key
     AND human_input.input_id=human_relation.input_id
    JOIN messages human_message ON human_message.room_id=wake.room_id
     AND (human_input.source_message_id=human_message.id
          OR jsonb_typeof(human_input.payload->'invocationMessageIds')='array'
             AND human_input.payload->'invocationMessageIds' @> to_jsonb(human_message.id))
    JOIN actors human_author ON human_author.id=human_message.author_actor_id
    WHERE human_relation.run_id=relation.run_id
      AND human_message.message_kind='conversation' AND human_author.kind='human'
  )
ORDER BY wake.delivered_at, wake.id
LIMIT 1;

-- name: CreateProactiveOutput :exec
-- Only the first Message of a wake Run is its output.
INSERT INTO proactive_outputs(message_id,tenant_id,owner_actor_id,room_id,source,local_run_id)
VALUES (sqlc.arg(message_id)::text,sqlc.arg(tenant_id)::text,sqlc.arg(owner_actor_id)::text,
        sqlc.arg(room_id)::text,sqlc.arg(source)::text,sqlc.arg(local_run_id)::text)
ON CONFLICT DO NOTHING;

-- name: UpsertProactivePotentialItem :execrows
-- A source item enters once a day, tracked or reminded; a repeat judgment is
-- ignored.
INSERT INTO proactive_potential_items(id,tenant_id,owner_actor_id,content,source,source_key,reminded)
VALUES (sqlc.arg(id)::text,sqlc.arg(tenant_id)::text,sqlc.arg(owner_actor_id)::text,
        sqlc.arg(content)::text,sqlc.arg(source)::text,sqlc.arg(source_key)::text,sqlc.arg(reminded)::boolean)
ON CONFLICT (tenant_id,owner_actor_id,source,source_key) DO NOTHING;

-- name: HasProactiveSignalForSource :one
-- Whether this source item was already judged today: a candidate is judged
-- once a day.
SELECT EXISTS(
  SELECT 1 FROM proactive_potential_items
  WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
    AND source=sqlc.arg(source)::text AND source_key=sqlc.arg(source_key)::text
)::boolean;

-- name: GetProactiveSignalReminded :one
-- Whether today's judgment of this source item could remind the Human; one
-- that quiet hours or the daily limit gated could only track it.
SELECT reminded FROM proactive_potential_items
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
  AND source=sqlc.arg(source)::text AND source_key=sqlc.arg(source_key)::text;

-- name: GetLatestProactiveGuideline :one
SELECT version,rules,deleted_rules,clues FROM proactive_guidelines
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
ORDER BY version DESC
LIMIT 1;

-- name: InsertProactiveGuideline :exec
-- The next version of a Human's guideline. Versions are consecutive, so a
-- writer that read an older latest version fails on the primary key.
INSERT INTO proactive_guidelines(tenant_id,owner_actor_id,version,rules,deleted_rules,clues,change_note)
VALUES (sqlc.arg(tenant_id)::text,sqlc.arg(owner_actor_id)::text,sqlc.arg(version)::integer,
        sqlc.arg(rules)::jsonb,sqlc.arg(deleted_rules)::jsonb,sqlc.arg(clues)::jsonb,sqlc.arg(change_note)::text);

-- name: CreateProactiveShadowDivergence :one
-- A replayed record returns the divergence already kept.
INSERT INTO proactive_shadow_divergences(id,tenant_id,owner_actor_id,rule_id,guideline_version,matter,shadow_action,taken_action)
VALUES (sqlc.arg(id)::text,sqlc.arg(tenant_id)::text,sqlc.arg(owner_actor_id)::text,sqlc.arg(rule_id)::text,
        sqlc.arg(guideline_version)::integer,sqlc.arg(matter)::text,sqlc.arg(shadow_action)::text,sqlc.arg(taken_action)::text)
ON CONFLICT (tenant_id,owner_actor_id,rule_id,guideline_version,matter,shadow_action,taken_action)
DO UPDATE SET matter=EXCLUDED.matter
RETURNING id,created_at;

-- name: PruneProactiveShadowDivergences :exec
-- Only the latest divergences are shown, so older ones are dropped as new
-- ones arrive.
DELETE FROM proactive_shadow_divergences
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
  AND id NOT IN (
    SELECT id FROM proactive_shadow_divergences
    WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
    ORDER BY created_at DESC, id DESC
    LIMIT sqlc.arg(keep)::integer
  );

-- name: ListProactiveShadowDivergences :many
SELECT id,rule_id,guideline_version,matter,shadow_action,taken_action,created_at
FROM proactive_shadow_divergences
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(take)::integer;

-- name: ListProactiveTrackingItems :many
-- The Human's current Tracking Items, by Memory's rule: current until due, or
-- for three months when undated.
SELECT id,kind,content,due_at FROM memory_index.tracking_items
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text AND status='open'
  AND coalesce(due_at>=now(),created_at>=now()-interval '3 months')
ORDER BY due_at NULLS LAST,created_at
LIMIT 100;

-- name: CountProactiveRemindedEvents :one
-- Events that woke AnotherMe today; the day's records are emptied each night.
SELECT count(*)::bigint FROM proactive_potential_items
WHERE tenant_id=sqlc.arg(tenant_id)::text AND owner_actor_id=sqlc.arg(owner_actor_id)::text
  AND source='event' AND reminded;

-- name: LockConnectionAutoReminders :one
-- Share-locks a connection against its auto reminders switch and reads the
-- switch, for the listener sweep's install.
SELECT auto_reminders FROM external_connections WHERE id=sqlc.arg(id)::text FOR SHARE;

-- name: ListAnotherMeConnectionsWithoutListener :many
-- The Human's own active connections of a listenable provider with auto
-- reminders on, granted to their active AnotherMe, with no listener Routine
-- for that connection yet. A connection ID narrows it to that connection.
SELECT registration.tenant_id, registration.represented_human_actor_id::text AS represented_human_actor_id,
       registration.actor_id AS agent_actor_id, room.id AS room_id,
       c.id AS connection_id, c.provider, c.identity_label
FROM agent_registrations registration
JOIN rooms room ON room.tenant_id=registration.tenant_id
  AND room.direct_human_actor_id=registration.represented_human_actor_id
  AND room.direct_agent_actor_id=registration.actor_id
  AND room.deletion_started_at IS NULL
JOIN external_connection_agent_grants d ON d.agent_actor_id=registration.actor_id AND d.tenant_id=registration.tenant_id
  AND d.represented_human_actor_id=registration.represented_human_actor_id AND d.status='active'
JOIN external_connections c ON c.id=d.connection_id AND c.status='active'
  AND c.provider=ANY(sqlc.arg(providers)::text[]) AND c.auto_reminders
  AND (sqlc.narg(connection_id)::text IS NULL OR c.id=sqlc.narg(connection_id)::text)
WHERE registration.agent_type='anotherme' AND registration.status='active'
  AND NOT EXISTS (
    SELECT 1 FROM room_reminders r
    WHERE r.template_agent_actor_id=registration.actor_id
      AND r.template_routine_key=sqlc.arg(routine_key_prefix)::text || c.id
  )
ORDER BY registration.tenant_id, registration.represented_human_actor_id, c.created_at, c.id
LIMIT 200;

-- name: GetAnotherMeHuman :one
SELECT represented_human_actor_id::text
FROM agent_registrations
WHERE actor_id=sqlc.arg(agent_actor_id)::text AND tenant_id=sqlc.arg(tenant_id)::text AND agent_type='anotherme';

-- name: ListProactiveMandates :many
-- The Work Items Another Me created under its Human's mandates, newest first.
SELECT activity.work_item_id, item.number, item.title, activity.details, activity.occurred_at,
       NOT proactive_mandate_in_force(activity.tenant_id, activity.details->>'owner_actor_id',
                                      activity.details->>'rule_id', activity.details->>'strength') AS revoked
FROM work_item_activities activity
JOIN work_items item ON item.id = activity.work_item_id AND item.tenant_id = activity.tenant_id
WHERE activity.tenant_id = sqlc.arg(tenant_id)::text AND activity.kind = 'mandate_recorded'
  AND activity.details->>'owner_actor_id' = sqlc.arg(owner_actor_id)::text
ORDER BY activity.occurred_at DESC
LIMIT sqlc.arg(take)::integer;
