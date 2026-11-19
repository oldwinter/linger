-- +goose Up
-- An imported message's Wiki source is keyed by its mailbox, the Connection's
-- remote principal key ("gmail:<address>" or "outlook:<user id>"), instead of
-- the Connection, so reconnecting the same mailbox updates the same Documents.
--
-- Sources that two Connections of one mailbox imported for the same message
-- merge into one: the message keeps the source whose Document is active and
-- bound to the Wiki, then the one written last. Every other source leaves the
-- Wiki the way Trash removes a Document, since a Document is never deleted:
-- its Document is trashed, its Bindings are suspended and its source row is
-- deleted. A source whose Connection has no mailbox identity cannot be keyed
-- and leaves the same way; mail is imported only after the Connection is
-- identified, so none is expected.
--
-- A removed source's published row stays, so the next Wiki refresh sends it
-- to LLM Wiki as a removed source and the pages citing it are rewritten
-- instead of linking a trashed Document. A Wiki that loses more removed
-- sources than one refresh accepts is refused until it is rebuilt. A frozen
-- refresh keeps its rows; if it settles, its removed sources are published
-- again and the next refresh removes them. Their unsettled try counts go with
-- them. Memory's hourly reconciliation drops removed sources it indexed.
CREATE TEMPORARY TABLE mail_wiki_source_merge AS
WITH item AS (
    SELECT item.tenant_id, item.owner_actor_id, item.source_key, item.document_id,
        connection.remote_principal_key AS mailbox,
        substr(item.source_key, length(split_part(item.source_key, ':', 2)) + 7) AS remote_id,
        document.status = 'active' AND EXISTS (
            SELECT 1 FROM document_context_bindings binding
            WHERE binding.tenant_id = item.tenant_id AND binding.document_id = item.document_id
              AND binding.binding_kind = 'wiki_source' AND binding.status = 'active') AS in_wiki,
        item.updated_at, item.created_at
    FROM wiki_source_items item
    JOIN documents document ON document.id = item.document_id AND document.tenant_id = item.tenant_id
    LEFT JOIN external_connections connection
      ON connection.id = split_part(item.source_key, ':', 2) AND connection.remote_principal_key <> ''
)
SELECT item.tenant_id, item.owner_actor_id, item.source_key, item.document_id,
    'mail:' || item.mailbox || ':' || item.remote_id AS mailbox_key,
    item.mailbox IS NOT NULL AND row_number() OVER (
        PARTITION BY item.tenant_id, item.owner_actor_id, item.mailbox, item.remote_id
        ORDER BY item.in_wiki DESC, item.updated_at DESC, item.created_at DESC, item.document_id) = 1 AS kept
FROM item;

DELETE FROM document_wiki_unsettled_sources unsettled
USING mail_wiki_source_merge merged
WHERE NOT merged.kept AND unsettled.tenant_id = merged.tenant_id AND unsettled.document_id = merged.document_id;

DELETE FROM wiki_source_items item
USING mail_wiki_source_merge merged
WHERE NOT merged.kept AND item.tenant_id = merged.tenant_id
  AND item.owner_actor_id = merged.owner_actor_id AND item.source_key = merged.source_key;

UPDATE wiki_source_items item
SET source_key = merged.mailbox_key
FROM mail_wiki_source_merge merged
WHERE merged.kept AND item.tenant_id = merged.tenant_id
  AND item.owner_actor_id = merged.owner_actor_id AND item.source_key = merged.source_key;

-- Each removed Document is trashed as one lifecycle operation, in Trash's
-- order: the status, the access invalidation, then its suspended Bindings.
WITH trashed AS (
    UPDATE documents document
    SET status = 'trashed',
        trashed_at = GREATEST(document.updated_at, clock_timestamp()),
        updated_at = GREATEST(document.updated_at, clock_timestamp())
    FROM mail_wiki_source_merge merged
    WHERE NOT merged.kept AND document.id = merged.document_id
      AND document.tenant_id = merged.tenant_id AND document.status = 'active'
    RETURNING document.id, document.tenant_id, document.owner_actor_id, document.updated_at
), counted AS (
    UPDATE document_permission_counts permission
    SET permission_count = permission.permission_count + 1
    FROM trashed
    WHERE permission.document_id = trashed.id
)
INSERT INTO document_events(
    id, tenant_id, document_id, event_type, actor_id, resource_kind, resource_id, projection_version, occurred_at
)
SELECT 'document_event_' || md5('merge_mail_wiki_source:' || trashed.id || ':' || event.type),
    trashed.tenant_id, trashed.id, event.type, trashed.owner_actor_id, 'lifecycle_operation',
    'document_lifecycle_' || md5('merge_mail_wiki_source:' || trashed.id), 1,
    GREATEST(clock_timestamp(), trashed.updated_at)
FROM trashed
CROSS JOIN (VALUES (1, 'document.access_invalidated'), (2, 'document.trashed')) event(position, type)
ORDER BY trashed.id, event.position;

WITH suspended AS (
    UPDATE document_context_bindings binding
    SET status = 'suspended', access_epoch = binding.access_epoch + 1, updated_at = clock_timestamp()
    FROM mail_wiki_source_merge merged
    WHERE NOT merged.kept AND binding.tenant_id = merged.tenant_id
      AND binding.document_id = merged.document_id AND binding.status = 'active'
    RETURNING binding.tenant_id, binding.document_id
)
INSERT INTO document_events(
    id, tenant_id, document_id, event_type, actor_id, resource_kind, resource_id, projection_version, occurred_at
)
SELECT 'document_event_' || md5('merge_mail_wiki_source:' || document.id || ':document.binding_updated'),
    document.tenant_id, document.id, 'document.binding_updated', document.owner_actor_id, 'binding_context',
    'document_lifecycle_' || md5('merge_mail_wiki_source:' || document.id), 1,
    GREATEST(clock_timestamp(), document.updated_at)
FROM documents document
WHERE (document.tenant_id, document.id) IN (SELECT tenant_id, document_id FROM suspended)
ORDER BY document.id;

DROP TABLE mail_wiki_source_merge;

-- The provider is the mailbox key's second segment.
CREATE OR REPLACE VIEW public.wiki_document_verdicts AS
 SELECT binding.wiki_id,
    binding.tenant_id,
    document.id AS document_id,
    COALESCE(version.filename, document.title) AS filename,
        CASE
            WHEN (item.document_id IS NULL) THEN 'my_pages'::text
            ELSE split_part(item.source_key, ':'::text, 2)
        END AS source,
    public.document_text_version_id(document.id, text.source_kind, text.source_id) AS version_id,
    (octet_length(text.markdown))::bigint AS size_bytes,
    text.updated_at AS decided_at,
    public.source_rejection_reason(document.native_import_status, version.filename, version.representation_format, text.source_kind, version.media_type, text.status, (octet_length(text.markdown))::bigint, text.longest_line_bytes) AS reason
   FROM ((((public.document_context_bindings binding
     JOIN public.documents document ON (((document.id = binding.document_id) AND (document.tenant_id = binding.tenant_id) AND (document.status = 'active'::text))))
     JOIN public.document_texts text ON ((text.document_id = document.id)))
     LEFT JOIN public.document_versions version ON (((text.source_kind = 'file_version'::text) AND (version.id = text.source_id) AND (version.document_id = document.id))))
     LEFT JOIN public.wiki_source_items item ON (((item.tenant_id = document.tenant_id) AND (item.document_id = document.id))))
  WHERE ((binding.binding_kind = 'wiki_source'::text) AND (binding.status = 'active'::text) AND (COALESCE(document.native_import_status, 'completed'::text) = ANY (ARRAY['completed'::text, 'failed'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.document_context_bindings page
          WHERE ((page.document_id = document.id) AND (page.tenant_id = document.tenant_id) AND (page.binding_kind = 'wiki_page'::text))))));

-- +goose Down
-- Merged sources stay merged and keyed by mailbox; only the view goes back.
CREATE OR REPLACE VIEW public.wiki_document_verdicts AS
 SELECT binding.wiki_id,
    binding.tenant_id,
    document.id AS document_id,
    COALESCE(version.filename, document.title) AS filename,
        CASE
            WHEN (item.document_id IS NULL) THEN 'my_pages'::text
            ELSE COALESCE(connection.provider, 'mail'::text)
        END AS source,
    public.document_text_version_id(document.id, text.source_kind, text.source_id) AS version_id,
    (octet_length(text.markdown))::bigint AS size_bytes,
    text.updated_at AS decided_at,
    public.source_rejection_reason(document.native_import_status, version.filename, version.representation_format, text.source_kind, version.media_type, text.status, (octet_length(text.markdown))::bigint, text.longest_line_bytes) AS reason
   FROM (((((public.document_context_bindings binding
     JOIN public.documents document ON (((document.id = binding.document_id) AND (document.tenant_id = binding.tenant_id) AND (document.status = 'active'::text))))
     JOIN public.document_texts text ON ((text.document_id = document.id)))
     LEFT JOIN public.document_versions version ON (((text.source_kind = 'file_version'::text) AND (version.id = text.source_id) AND (version.document_id = document.id))))
     LEFT JOIN public.wiki_source_items item ON (((item.tenant_id = document.tenant_id) AND (item.document_id = document.id))))
     LEFT JOIN public.external_connections connection ON ((connection.id = split_part(item.source_key, ':'::text, 2))))
  WHERE ((binding.binding_kind = 'wiki_source'::text) AND (binding.status = 'active'::text) AND (COALESCE(document.native_import_status, 'completed'::text) = ANY (ARRAY['completed'::text, 'failed'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.document_context_bindings page
          WHERE ((page.document_id = document.id) AND (page.tenant_id = document.tenant_id) AND (page.binding_kind = 'wiki_page'::text))))));
