-- +goose Up
CREATE TABLE gmail_canvas_drafts (
    connection_id text NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
    draft_id text NOT NULL CHECK (length(draft_id) BETWEEN 1 AND 256),
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_digest text NOT NULL CHECK (source_digest ~ '^sha256:[0-9a-f]{64}$'),
    PRIMARY KEY (connection_id, draft_id)
);
CREATE INDEX gmail_canvas_drafts_document_idx ON gmail_canvas_drafts(document_id);

-- One draft save per Gmail connection at a time, held without a database
-- connection while the upload runs; an expired lease may be taken over.
CREATE TABLE gmail_canvas_draft_leases (
    connection_id text PRIMARY KEY REFERENCES external_connections(id) ON DELETE CASCADE,
    holder text NOT NULL,
    expires_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE gmail_canvas_draft_leases;
DROP TABLE gmail_canvas_drafts;
