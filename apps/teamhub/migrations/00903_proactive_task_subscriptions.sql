-- +goose Up
-- Task Subscriptions route follow-up activity on an external thread (mail,
-- herdr / herdr-core, or GitHub issue/PR) directly to the delegated Task that
-- Another Me started, without requiring another mention or manual `task send`.
-- Active tasks receive follow-ups immediately; ended tasks resume only on
-- human-authored messages, never on bot, CI, automated, or system events. Both
-- the Human owner and Another Me may drop a subscription idempotently.

CREATE TABLE public.task_subscriptions (
    id text PRIMARY KEY CHECK (id ~ '^tsub_[a-f0-9]{32}$'),
    tenant_id text NOT NULL,
    owner_actor_id text NOT NULL,
    task_id text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('mail', 'herdr', 'github')),
    normalized_source_key text NOT NULL CHECK (length(normalized_source_key) BETWEEN 1 AND 512),
    display_label text NOT NULL DEFAULT '' CHECK (length(display_label) <= 256),
    rule_id text CHECK (rule_id IS NULL OR rule_id ~ '^pr_[a-f0-9]{32}$'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped')),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    dropped_at timestamptz,
    dropped_by_kind text CHECK (dropped_by_kind IS NULL OR dropped_by_kind IN ('owner', 'another_me')),
    dropped_by_actor_id text,
    drop_reason text NOT NULL DEFAULT '' CHECK (length(drop_reason) <= 500),
    CONSTRAINT task_subscriptions_dropped_shape CHECK (
        (status = 'active' AND dropped_at IS NULL AND dropped_by_kind IS NULL AND dropped_by_actor_id IS NULL AND drop_reason = '')
        OR
        (status = 'dropped' AND dropped_at IS NOT NULL AND dropped_by_kind IS NOT NULL AND dropped_by_actor_id IS NOT NULL)
    ),
    CONSTRAINT task_subscriptions_task_fk FOREIGN KEY (task_id, tenant_id) REFERENCES public.work_items(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT task_subscriptions_owner_fk FOREIGN KEY (owner_actor_id, tenant_id) REFERENCES public.actors(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT task_subscriptions_created_by_fk FOREIGN KEY (created_by_actor_id, tenant_id) REFERENCES public.actors(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT task_subscriptions_dropped_by_fk FOREIGN KEY (dropped_by_actor_id, tenant_id) REFERENCES public.actors(id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX task_subscriptions_active_unique_idx
    ON public.task_subscriptions (tenant_id, owner_actor_id, source_type, normalized_source_key, task_id)
    WHERE status = 'active';

CREATE INDEX task_subscriptions_routing_idx
    ON public.task_subscriptions (tenant_id, owner_actor_id, source_type, normalized_source_key)
    WHERE status = 'active';

CREATE INDEX task_subscriptions_task_idx
    ON public.task_subscriptions (tenant_id, task_id, created_at DESC, id DESC);

CREATE TABLE public.task_subscription_deliveries (
    subscription_id text NOT NULL REFERENCES public.task_subscriptions(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,
    task_id text NOT NULL,
    event_dedupe_key text NOT NULL CHECK (length(event_dedupe_key) BETWEEN 1 AND 256),
    event_source text NOT NULL CHECK (length(event_source) BETWEEN 1 AND 100),
    event_external_id text NOT NULL CHECK (length(event_external_id) BETWEEN 1 AND 500),
    event_state text NOT NULL DEFAULT '' CHECK (length(event_state) <= 500),
    actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'bot', 'ci', 'automated', 'system', 'unknown')),
    outcome text NOT NULL CHECK (outcome IN ('routed', 'resumed', 'skipped_non_human_ended', 'skipped_task_closed', 'skipped_dropped')),
    task_execution_revision bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subscription_id, event_dedupe_key),
    CONSTRAINT task_subscription_deliveries_task_fk FOREIGN KEY (task_id, tenant_id) REFERENCES public.work_items(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX task_subscription_deliveries_task_idx
    ON public.task_subscription_deliveries (tenant_id, task_id, created_at DESC);

ALTER TABLE public.task_input_revisions
    DROP CONSTRAINT task_input_revisions_cause_check,
    ADD CONSTRAINT task_input_revisions_cause_check CHECK (
        cause = ANY (ARRAY['creation'::text, 'human_message'::text, 'meta_message'::text, 'system'::text, 'subscription_event'::text])
    );

-- +goose Down
ALTER TABLE public.task_input_revisions
    DROP CONSTRAINT task_input_revisions_cause_check,
    ADD CONSTRAINT task_input_revisions_cause_check CHECK (
        cause = ANY (ARRAY['creation'::text, 'human_message'::text, 'meta_message'::text, 'system'::text])
    );

DROP TABLE public.task_subscription_deliveries;
DROP TABLE public.task_subscriptions;
