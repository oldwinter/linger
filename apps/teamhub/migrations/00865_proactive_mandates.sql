-- +goose Up
-- Another Me may act beyond reminding only under a mandate its Human grants
-- on an active rule in My Rules: create a Work Item, or create and delegate
-- it. Nightly learning never grants one, so every existing rule starts with
-- none. Each act records an immutable Mandate as a Work Item activity in the
-- transaction that creates the Work Item; lowering the rule's mandate or
-- deleting the rule revokes it for later acts.
UPDATE proactive_guidelines g SET rules = (
    SELECT jsonb_agg(rule || '{"mandate": "none"}'::jsonb ORDER BY position)
    FROM jsonb_array_elements(g.rules) WITH ORDINALITY AS item(rule, position)
)
WHERE jsonb_array_length(g.rules) > 0;

ALTER TABLE work_item_activities
    DROP CONSTRAINT work_item_activities_kind_check,
    DROP CONSTRAINT work_item_activities_details_shape;
ALTER TABLE work_item_activities
    ADD CONSTRAINT work_item_activities_kind_check CHECK (kind IN ('created', 'metadata_updated', 'state_transitioned', 'archived', 'unarchived', 'assignment_added', 'assignment_removed', 'access_grant_added', 'access_grant_removed', 'comment_edited', 'comment_deleted', 'work_room_created', 'execution_control_requested', 'task_recovery_decision', 'mandate_recorded')),
    ADD CONSTRAINT work_item_activities_details_shape CHECK (((jsonb_typeof(details) = 'object'::text) AND (((kind <> ALL (ARRAY['execution_control_requested'::text, 'task_recovery_decision'::text, 'mandate_recorded'::text])) AND (details = '{}'::jsonb)) OR ((kind = 'execution_control_requested'::text) AND ((details ->> 'action'::text) = ANY (ARRAY['pause'::text, 'resume'::text, 'terminate'::text])) AND (jsonb_typeof((details -> 'generation'::text)) = 'number'::text) AND (((details ->> 'generation'::text))::bigint >= 1) AND (jsonb_typeof((details -> 'control_revision'::text)) = 'number'::text) AND (((details ->> 'control_revision'::text))::bigint >= 1) AND ((details ->> 'source_kind'::text) = 'human'::text) AND ((length((details ->> 'source_id'::text)) >= 1) AND (length((details ->> 'source_id'::text)) <= 255)) AND ((NOT (details ? 'reason'::text)) OR ((jsonb_typeof((details -> 'reason'::text)) = 'string'::text) AND (length((details ->> 'reason'::text)) <= 1000))) AND ((details - ARRAY['action'::text, 'generation'::text, 'control_revision'::text, 'source_kind'::text, 'source_id'::text, 'reason'::text]) = '{}'::jsonb)) OR ((kind = 'task_recovery_decision'::text) AND ((details ->> 'action'::text) = ANY (ARRAY['retry'::text, 'terminate'::text])) AND (jsonb_typeof((details -> 'generation'::text)) = 'number'::text) AND (((details ->> 'generation'::text))::bigint >= 1) AND ((length((details ->> 'intervention_id'::text)) >= 1) AND (length((details ->> 'intervention_id'::text)) <= 255)) AND (jsonb_typeof((details -> 'intervention_version'::text)) = 'number'::text) AND (((details ->> 'intervention_version'::text))::bigint >= 2) AND ((details ->> 'source_kind'::text) = 'human'::text) AND ((details - ARRAY['action'::text, 'generation'::text, 'intervention_id'::text, 'intervention_version'::text, 'source_kind'::text]) = '{}'::jsonb))) OR ((kind = 'mandate_recorded'::text) AND ((details ->> 'owner_actor_id'::text) <> ''::text) AND ((details ->> 'rule_id'::text) ~ '^pr_[a-f0-9]{32}$'::text) AND ((length((details ->> 'rule_text'::text)) >= 1) AND (length((details ->> 'rule_text'::text)) <= 200)) AND (jsonb_typeof((details -> 'guideline_version'::text)) = 'number'::text) AND (((details ->> 'guideline_version'::text))::integer >= 1) AND ((length((details ->> 'event_source'::text)) >= 1) AND (length((details ->> 'event_source'::text)) <= 100)) AND ((length((details ->> 'event_external_id'::text)) >= 1) AND (length((details ->> 'event_external_id'::text)) <= 500)) AND ((details ->> 'strength'::text) = ANY (ARRAY['create'::text, 'create_and_delegate'::text])) AND ((details - ARRAY['owner_actor_id'::text, 'rule_id'::text, 'rule_text'::text, 'guideline_version'::text, 'event_source'::text, 'event_external_id'::text, 'strength'::text]) = '{}'::jsonb))));

CREATE INDEX work_item_activities_mandates_idx
    ON work_item_activities (tenant_id, (details ->> 'owner_actor_id'), occurred_at DESC)
    WHERE kind = 'mandate_recorded';

-- Whether the Human's current rules still grant a Mandate's strength: the
-- rule is in their latest guideline, active, with at least that mandate.
CREATE FUNCTION proactive_mandate_in_force(p_tenant_id text, p_owner_actor_id text, p_rule_id text, p_strength text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
SELECT EXISTS (
    SELECT 1
    FROM (SELECT rules FROM proactive_guidelines
          WHERE tenant_id = p_tenant_id AND owner_actor_id = p_owner_actor_id
          ORDER BY version DESC LIMIT 1) latest,
         jsonb_array_elements(latest.rules) AS rule
    WHERE rule ->> 'id' = p_rule_id AND rule ->> 'status' = 'active'
      AND (rule ->> 'mandate' = 'create_and_delegate'
           OR p_strength = 'create' AND rule ->> 'mandate' = 'create')
)
$$;

-- +goose Down
DROP FUNCTION proactive_mandate_in_force(text, text, text, text);
DROP INDEX work_item_activities_mandates_idx;
DELETE FROM work_item_activities WHERE kind = 'mandate_recorded';
ALTER TABLE work_item_activities
    DROP CONSTRAINT work_item_activities_kind_check,
    DROP CONSTRAINT work_item_activities_details_shape;
ALTER TABLE work_item_activities
    ADD CONSTRAINT work_item_activities_kind_check CHECK (kind IN ('created', 'metadata_updated', 'state_transitioned', 'archived', 'unarchived', 'assignment_added', 'assignment_removed', 'access_grant_added', 'access_grant_removed', 'comment_edited', 'comment_deleted', 'work_room_created', 'execution_control_requested', 'task_recovery_decision')),
    ADD CONSTRAINT work_item_activities_details_shape CHECK (((jsonb_typeof(details) = 'object'::text) AND (((kind <> ALL (ARRAY['execution_control_requested'::text, 'task_recovery_decision'::text])) AND (details = '{}'::jsonb)) OR ((kind = 'execution_control_requested'::text) AND ((details ->> 'action'::text) = ANY (ARRAY['pause'::text, 'resume'::text, 'terminate'::text])) AND (jsonb_typeof((details -> 'generation'::text)) = 'number'::text) AND (((details ->> 'generation'::text))::bigint >= 1) AND (jsonb_typeof((details -> 'control_revision'::text)) = 'number'::text) AND (((details ->> 'control_revision'::text))::bigint >= 1) AND ((details ->> 'source_kind'::text) = 'human'::text) AND ((length((details ->> 'source_id'::text)) >= 1) AND (length((details ->> 'source_id'::text)) <= 255)) AND ((NOT (details ? 'reason'::text)) OR ((jsonb_typeof((details -> 'reason'::text)) = 'string'::text) AND (length((details ->> 'reason'::text)) <= 1000))) AND ((details - ARRAY['action'::text, 'generation'::text, 'control_revision'::text, 'source_kind'::text, 'source_id'::text, 'reason'::text]) = '{}'::jsonb)) OR ((kind = 'task_recovery_decision'::text) AND ((details ->> 'action'::text) = ANY (ARRAY['retry'::text, 'terminate'::text])) AND (jsonb_typeof((details -> 'generation'::text)) = 'number'::text) AND (((details ->> 'generation'::text))::bigint >= 1) AND ((length((details ->> 'intervention_id'::text)) >= 1) AND (length((details ->> 'intervention_id'::text)) <= 255)) AND (jsonb_typeof((details -> 'intervention_version'::text)) = 'number'::text) AND (((details ->> 'intervention_version'::text))::bigint >= 2) AND ((details ->> 'source_kind'::text) = 'human'::text) AND ((details - ARRAY['action'::text, 'generation'::text, 'intervention_id'::text, 'intervention_version'::text, 'source_kind'::text]) = '{}'::jsonb)))));
UPDATE proactive_guidelines g SET rules = (
    SELECT jsonb_agg(rule - 'mandate' ORDER BY position)
    FROM jsonb_array_elements(g.rules) WITH ORDINALITY AS item(rule, position)
)
WHERE jsonb_array_length(g.rules) > 0;
