-- +goose Up
-- Counts an epoch's failed reconciliations after its Capture's Stop and its
-- recorder's terminal receipt, and holds the next one back, so a recorder
-- that TeamHub can never settle ends the Capture instead of retrying forever.
ALTER TABLE public.voice_media_epochs
    ADD COLUMN stop_reconcile_failures integer DEFAULT 0 NOT NULL,
    ADD COLUMN stop_reconcile_retry_at timestamp with time zone,
    ADD CONSTRAINT voice_media_epochs_stop_reconcile_failures_check CHECK ((stop_reconcile_failures >= 0));

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'voice stop reconcile failures migration is forward-only';
END $$;
-- +goose StatementEnd
