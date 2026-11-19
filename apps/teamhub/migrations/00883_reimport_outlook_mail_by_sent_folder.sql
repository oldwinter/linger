-- +goose Up
-- Outlook mail direction now comes from the mailbox's Sent Items folder
-- instead of the identity label, which for a personal account signed in with
-- another provider's address is that sign-in address, not the mailbox. Every
-- Outlook snapshot is dropped so it is read again with the right direction.
--
-- A running import's next page finds no running snapshot and ends. An active
-- Connection that had a snapshot gets a mail connection job, which starts a
-- new one; nothing else starts it without the user. Re-imported messages
-- replace their Wiki sources by the same mailbox key.
--
-- The jobs wait 30 minutes: this migration runs before the rolling update, and
-- a pod still on the old direction logic that took one would complete the
-- import wrongly with nothing left to reset it.
CREATE TEMPORARY TABLE outlook_mail_reimport AS
SELECT connection.id, connection.account_id, actor.tenant_id, connection.status = 'active' AS active
FROM external_connections connection
LEFT JOIN actors actor ON actor.account_id = connection.account_id AND actor.kind = 'human'
WHERE connection.provider = 'outlook' AND connection.mail_import_revision IS NOT NULL;

DELETE FROM external_mail_import_documents document
USING outlook_mail_reimport reimport
WHERE document.connection_id = reimport.id;

UPDATE external_connections connection
SET mail_import_status = NULL, mail_import_revision = NULL, mail_import_tenant_id = NULL,
    mail_import_error_code = NULL, mail_import_cursor = NULL, mail_import_read = NULL,
    mail_import_provider_calls = NULL, mail_synced_until = NULL
FROM outlook_mail_reimport reimport
WHERE connection.id = reimport.id;

INSERT INTO river_job(kind, queue, args, max_attempts, state, scheduled_at)
SELECT 'external.mail_connection', 'external',
    jsonb_build_object('account_id', reimport.account_id, 'tenant_id', reimport.tenant_id, 'connection_id', reimport.id), 10,
    'scheduled', now() + interval '30 minutes'
FROM outlook_mail_reimport reimport
WHERE reimport.active AND reimport.tenant_id IS NOT NULL
ORDER BY reimport.id;

SELECT notify_river_queue('external');

DROP TABLE outlook_mail_reimport;

-- +goose Down
-- The dropped snapshots are not restored; the next import reads them again.
