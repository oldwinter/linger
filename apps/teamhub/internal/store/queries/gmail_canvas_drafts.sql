-- name: UpsertGmailCanvasDraft :exec
INSERT INTO gmail_canvas_drafts(connection_id, draft_id, document_id, source_digest)
VALUES ($1, $2, $3, $4)
ON CONFLICT (connection_id, draft_id) DO UPDATE
SET document_id = EXCLUDED.document_id, source_digest = EXCLUDED.source_digest;

-- name: GetGmailCanvasDraft :one
SELECT draft.document_id, draft.source_digest, document.tenant_id
FROM gmail_canvas_drafts draft
JOIN documents document ON document.id = draft.document_id
WHERE draft.connection_id = $1 AND draft.draft_id = $2;

-- name: AcquireGmailCanvasDraftLease :execrows
INSERT INTO gmail_canvas_draft_leases(connection_id, holder, expires_at)
VALUES (sqlc.arg(connection_id), sqlc.arg(holder), clock_timestamp() + make_interval(secs => sqlc.arg(seconds)::float8))
ON CONFLICT (connection_id) DO UPDATE
SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
WHERE gmail_canvas_draft_leases.expires_at < clock_timestamp();

-- name: HoldGmailCanvasDraftLease :one
SELECT holder FROM gmail_canvas_draft_leases
WHERE connection_id = $1 AND holder = $2 AND expires_at > clock_timestamp()
FOR UPDATE;

-- name: ReleaseGmailCanvasDraftLease :exec
DELETE FROM gmail_canvas_draft_leases WHERE connection_id = $1 AND holder = $2;
