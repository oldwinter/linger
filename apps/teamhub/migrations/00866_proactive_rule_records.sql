-- +goose Up
-- A learned rule becomes a record the Human can see, pin, edit, delete and
-- promote: {id, text, status, pinned, source, created_at, promoted_at,
-- guideline_version}. Only active rules decide; Memory writes newly learned
-- rules as shadow. A guideline version stays immutable, so every change by
-- dreaming or by the Human appends the next version. deleted_rules keeps what
-- the Human deleted so dreaming does not learn it again from old evidence.
ALTER TABLE proactive_guidelines
    ADD COLUMN rules jsonb,
    ADD COLUMN deleted_rules jsonb DEFAULT '[]'::jsonb NOT NULL;

-- Every existing rule was already deciding, so it converts as active. A rule
-- keeps one ID for its text across the Human's versions, with the time and
-- version it first appeared.
WITH firsts AS (
    SELECT g.tenant_id, g.owner_actor_id, rule.text,
           min(g.version) AS first_version, min(g.created_at) AS first_at
    FROM proactive_guidelines g, jsonb_array_elements_text(g.specific) AS rule(text)
    GROUP BY g.tenant_id, g.owner_actor_id, rule.text
)
UPDATE proactive_guidelines g SET rules = (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', 'pr_' || md5(g.tenant_id || ' ' || g.owner_actor_id || ' ' || rule.text),
        'text', rule.text,
        'status', 'active',
        'pinned', false,
        'source', 'learned',
        'created_at', firsts.first_at,
        'promoted_at', firsts.first_at,
        'guideline_version', firsts.first_version
    ) ORDER BY rule.position), '[]'::jsonb)
    FROM jsonb_array_elements_text(g.specific) WITH ORDINALITY AS rule(text, position)
    JOIN firsts ON firsts.tenant_id = g.tenant_id AND firsts.owner_actor_id = g.owner_actor_id
     AND firsts.text = rule.text
);

DROP VIEW memory_source.proactive_guidelines;
DROP FUNCTION memory_source.record_proactive_guideline(text, text, integer, jsonb, jsonb, text);

ALTER TABLE proactive_guidelines
    DROP COLUMN specific,
    ALTER COLUMN rules SET NOT NULL,
    ADD CONSTRAINT proactive_guidelines_rules_check
        CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) <= 20),
    ADD CONSTRAINT proactive_guidelines_deleted_rules_check
        CHECK (jsonb_typeof(deleted_rules) = 'array' AND jsonb_array_length(deleted_rules) <= 20);

CREATE VIEW memory_source.proactive_guidelines AS
SELECT tenant_id, owner_actor_id, version, rules, deleted_rules, clues
FROM public.proactive_guidelines;

-- Dreaming read version - 1, so a version the Human wrote meanwhile makes the
-- insert fail and the night's learning is retried the next night.
CREATE FUNCTION memory_source.record_proactive_guideline(p_tenant_id text, p_owner_actor_id text, p_version integer, p_rules jsonb, p_deleted_rules jsonb, p_clues jsonb, p_change_note text) RETURNS void
    LANGUAGE sql
    AS $$
INSERT INTO proactive_guidelines (tenant_id, owner_actor_id, version, rules, deleted_rules, clues, change_note)
VALUES (p_tenant_id, p_owner_actor_id, p_version, p_rules, p_deleted_rules, p_clues, p_change_note)
$$;

-- What a Run judged differently from a shadow rule: the shadow rule would
-- have taken shadow_action where the active rules took taken_action. The
-- Human reads these before promoting the rule. One fact is kept once, so a
-- replayed record changes nothing.
CREATE TABLE proactive_shadow_divergences (
    id text PRIMARY KEY CHECK (id ~ '^psd_[a-f0-9]{32}$'),
    tenant_id text NOT NULL,
    owner_actor_id text NOT NULL,
    rule_id text NOT NULL,
    guideline_version integer NOT NULL CHECK (guideline_version >= 1),
    matter text NOT NULL CHECK (length(matter) BETWEEN 1 AND 300),
    shadow_action text NOT NULL CHECK (shadow_action IN ('notify', 'track', 'silent')),
    taken_action text NOT NULL CHECK (taken_action IN ('notify', 'track', 'silent')),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CHECK (shadow_action <> taken_action),
    UNIQUE (tenant_id, owner_actor_id, rule_id, guideline_version, matter, shadow_action, taken_action)
);

CREATE INDEX proactive_shadow_divergences_owner_idx
    ON proactive_shadow_divergences (tenant_id, owner_actor_id, created_at DESC);

-- +goose Down
DROP TABLE proactive_shadow_divergences;
DROP VIEW memory_source.proactive_guidelines;
DROP FUNCTION memory_source.record_proactive_guideline(text, text, integer, jsonb, jsonb, jsonb, text);

ALTER TABLE proactive_guidelines ADD COLUMN specific jsonb;
UPDATE proactive_guidelines g SET specific = (
    SELECT coalesce(jsonb_agg(rule->'text' ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(g.rules) WITH ORDINALITY AS item(rule, position)
);
ALTER TABLE proactive_guidelines
    DROP COLUMN rules,
    DROP COLUMN deleted_rules,
    ALTER COLUMN specific SET NOT NULL,
    ADD CONSTRAINT proactive_guidelines_specific_check
        CHECK (jsonb_typeof(specific) = 'array' AND jsonb_array_length(specific) <= 20);

CREATE VIEW memory_source.proactive_guidelines AS
SELECT tenant_id, owner_actor_id, version, specific, clues
FROM public.proactive_guidelines;

CREATE FUNCTION memory_source.record_proactive_guideline(p_tenant_id text, p_owner_actor_id text, p_version integer, p_specific jsonb, p_clues jsonb, p_change_note text) RETURNS void
    LANGUAGE sql
    AS $$
INSERT INTO proactive_guidelines (tenant_id, owner_actor_id, version, specific, clues, change_note)
VALUES (p_tenant_id, p_owner_actor_id, p_version, p_specific, p_clues, p_change_note)
$$;
