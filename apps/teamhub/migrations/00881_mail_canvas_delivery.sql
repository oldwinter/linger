-- +goose Up
CREATE TABLE mail_canvas_deliveries (
    document_id text PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    id text NOT NULL UNIQUE,
    account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    connection_id text REFERENCES external_connections(id) ON DELETE CASCADE,
    source_digest text NOT NULL CHECK (source_digest ~ '^sha256:[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('queued', 'uploading', 'sending', 'sent', 'failed', 'unknown', 'declined')),
    CHECK ((status = 'declined') = (connection_id IS NULL)),
    draft_id text NOT NULL DEFAULT '',
    message_id text NOT NULL DEFAULT '',
    error_message text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- +goose Down
DROP TABLE mail_canvas_deliveries;
