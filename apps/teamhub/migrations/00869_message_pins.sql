-- +goose Up
-- A Pin is a Room-wide bookmark on one conversation Message. Any member may
-- add or remove it, and the Message is pinned once per Room regardless of who
-- pinned it or how often the request repeats.
CREATE TABLE public.message_pins (
    tenant_id text NOT NULL,
    room_id text NOT NULL,
    message_id text NOT NULL,
    pinned_by_actor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_pins_pkey PRIMARY KEY (room_id, message_id),
    CONSTRAINT message_pins_room_id_tenant_id_fkey FOREIGN KEY (room_id, tenant_id) REFERENCES public.rooms (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT message_pins_message_id_tenant_id_room_id_fkey FOREIGN KEY (message_id, tenant_id, room_id) REFERENCES public.messages (id, tenant_id, room_id) ON DELETE CASCADE,
    CONSTRAINT message_pins_pinned_by_actor_id_tenant_id_fkey FOREIGN KEY (pinned_by_actor_id, tenant_id) REFERENCES public.actors (id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX message_pins_room_order_idx ON public.message_pins USING btree (room_id, created_at DESC);

-- +goose Down
DROP TABLE public.message_pins;
