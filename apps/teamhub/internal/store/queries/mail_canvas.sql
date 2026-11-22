-- name: GetMailCanvasDelivery :one
SELECT * FROM mail_canvas_deliveries WHERE document_id = $1;

-- name: GetMailCanvasDeliveryByID :one
SELECT * FROM mail_canvas_deliveries WHERE id = $1;

-- name: StartMailCanvasDelivery :one
INSERT INTO mail_canvas_deliveries (document_id, id, account_id, connection_id, source_digest, status)
VALUES ($1, $2, $3, $4, $5, 'queued')
ON CONFLICT (document_id) DO UPDATE
SET id=EXCLUDED.id, account_id=EXCLUDED.account_id, connection_id=EXCLUDED.connection_id,
    -- A draft lives in one mailbox; another connection starts a new one.
    draft_id=CASE WHEN mail_canvas_deliveries.connection_id IS NOT DISTINCT FROM EXCLUDED.connection_id
                  THEN mail_canvas_deliveries.draft_id ELSE '' END,
    source_digest=EXCLUDED.source_digest, status='queued', error_message='', updated_at=clock_timestamp()
WHERE mail_canvas_deliveries.status IN ('failed', 'unknown')
RETURNING *;

-- name: UpdateMailCanvasDelivery :one
UPDATE mail_canvas_deliveries
SET status=sqlc.arg(status), draft_id=sqlc.arg(draft_id), message_id=sqlc.arg(message_id),
    error_message=sqlc.arg(error_message), updated_at=clock_timestamp()
WHERE id=sqlc.arg(id) AND status=sqlc.arg(expected_status)
RETURNING *;

-- name: DeclineMailCanvasDelivery :one
INSERT INTO mail_canvas_deliveries (document_id, id, account_id, connection_id, source_digest, status)
VALUES ($1, $2, $3, NULL, $4, 'declined')
ON CONFLICT (document_id) DO UPDATE
SET id=EXCLUDED.id, account_id=EXCLUDED.account_id, connection_id=NULL,
    source_digest=EXCLUDED.source_digest, status='declined', error_message='', updated_at=clock_timestamp()
WHERE mail_canvas_deliveries.status IN ('failed', 'unknown')
RETURNING *;

-- name: MailCanvasDeliveryHolds :one
-- A card delivery that may have sent, or still may, owns the canvas: no other
-- path sends it.
SELECT EXISTS (
  SELECT 1 FROM mail_canvas_deliveries
  WHERE document_id = $1 AND status IN ('queued', 'uploading', 'sending', 'sent', 'unknown')
);

-- name: RecordAgentMailCanvasSend :exec
-- An Agent's confirmed send of a canvas draft, so the card never sends it
-- again; an active card delivery already refused that send.
INSERT INTO mail_canvas_deliveries (document_id, id, account_id, connection_id, source_digest, status, error_message)
VALUES ($1, $2, $3, $4, $5, sqlc.arg(status), sqlc.arg(error_message))
ON CONFLICT (document_id) DO UPDATE
SET id=EXCLUDED.id, account_id=EXCLUDED.account_id, connection_id=EXCLUDED.connection_id,
    source_digest=EXCLUDED.source_digest, status=EXCLUDED.status, draft_id='', message_id='',
    error_message=EXCLUDED.error_message, updated_at=clock_timestamp()
WHERE mail_canvas_deliveries.status IN ('failed', 'declined');
