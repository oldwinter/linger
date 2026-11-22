-- name: ListWebSearchKeys :many
-- At most one row per backend; callers pick the one they need.
SELECT backend,api_key_ciphertext,state,quota_remaining,quota_limit,quota_resets_at,quota_observed_at
FROM web_search_keys
ORDER BY backend;

-- name: UpsertWebSearchKey :exec
-- A new key starts with no observed quota.
INSERT INTO web_search_keys (backend,api_key_ciphertext,state)
VALUES (sqlc.arg(backend)::text,sqlc.arg(api_key_ciphertext)::bytea,sqlc.arg(state)::text)
ON CONFLICT (backend) DO UPDATE SET
  api_key_ciphertext=excluded.api_key_ciphertext,state=excluded.state,
  quota_remaining=NULL,quota_limit=NULL,quota_resets_at=NULL,quota_observed_at=NULL,updated_at=now();

-- name: DeleteWebSearchKey :exec
DELETE FROM web_search_keys WHERE backend=sqlc.arg(backend)::text;

-- name: MarkWebSearchKeyRejected :exec
-- Matching the sealed key leaves a key saved since the refused call alone.
UPDATE web_search_keys SET state='rejected',updated_at=now()
WHERE backend=sqlc.arg(backend)::text AND api_key_ciphertext=sqlc.arg(api_key_ciphertext)::bytea;

-- name: RecordWebSearchKeyAnswer :exec
-- An answered call proves the key; quota columns change only when the
-- response reported quota.
UPDATE web_search_keys SET state='verified',
  quota_remaining=CASE WHEN sqlc.arg(has_quota)::boolean THEN sqlc.narg(quota_remaining)::double precision ELSE quota_remaining END,
  quota_limit=CASE WHEN sqlc.arg(has_quota)::boolean THEN sqlc.narg(quota_limit)::double precision ELSE quota_limit END,
  quota_resets_at=CASE WHEN sqlc.arg(has_quota)::boolean THEN sqlc.narg(quota_resets_at)::timestamptz ELSE quota_resets_at END,
  quota_observed_at=CASE WHEN sqlc.arg(has_quota)::boolean THEN now() ELSE quota_observed_at END,
  updated_at=now()
WHERE backend=sqlc.arg(backend)::text AND api_key_ciphertext=sqlc.arg(api_key_ciphertext)::bytea;

-- name: GetWebSearchDefaultBackend :one
SELECT COALESCE(default_backend,'')::text AS default_backend FROM web_search_settings WHERE singleton;

-- name: SetWebSearchDefaultBackend :exec
INSERT INTO web_search_settings (singleton,default_backend)
VALUES (true,sqlc.narg(default_backend)::text)
ON CONFLICT (singleton) DO UPDATE SET default_backend=excluded.default_backend,updated_at=now();

-- name: ClearWebSearchDefaultBackend :exec
-- Removing a key also drops it as the default, so searches fall back to
-- TeamHub's order instead of asking for the removed key.
UPDATE web_search_settings SET default_backend=NULL,updated_at=now()
WHERE default_backend=sqlc.arg(backend)::text;
