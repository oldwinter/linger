-- +goose Up
-- Document texts come only from text layers, never from OCR, so a ready PDF
-- text always has one and the scanned flag goes away; a PDF without text is
-- still rejected from the Wiki as scanned. Texts that came from OCR alone are
-- converted once: a PDF read by OCR alone has no text and a raster image is
-- unsupported, and Memory's hourly reconciliation drops any of them it
-- indexed. A PDF with a text layer keeps its stored text, including lines OCR
-- added for its image areas, until a new Version replaces it; nothing is
-- normalized again.
UPDATE document_texts
SET status = 'no_text', markdown = '', markdown_sha256 = NULL,
    search_text = '', longest_line_bytes = 0, updated_at = clock_timestamp()
WHERE status = 'ready' AND scanned;

UPDATE document_texts text
SET status = 'unsupported', markdown = '', markdown_sha256 = NULL,
    search_text = '', longest_line_bytes = 0, updated_at = clock_timestamp()
FROM document_versions version
WHERE text.source_kind = 'file_version' AND text.status = 'ready'
  AND version.id = text.source_id AND version.document_id = text.document_id
  AND lower(trim(split_part(version.media_type, ';', 1))) <> 'image/svg+xml'
  AND (lower(trim(split_part(version.media_type, ';', 1))) LIKE 'image/%'
       OR (lower(trim(split_part(version.media_type, ';', 1))) IN ('', 'application/octet-stream')
           AND lower(substring(version.filename FROM '\.([^.]+)$')) IN
               ('avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp')));

DROP VIEW public.wiki_current_sources;
DROP VIEW public.wiki_document_verdicts;
DROP FUNCTION public.source_rejection_reason(text, text, text, text, text, text, boolean, bigint, bigint);
ALTER TABLE document_texts DROP COLUMN scanned;

-- +goose StatementBegin
CREATE FUNCTION public.source_rejection_reason(import_status text, file_name text, representation text, kind text, mime text, text_status text, text_bytes bigint, line_bytes bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT
    CASE
        WHEN import_status = 'failed' THEN 'unreadable'
        WHEN lower(coalesce(file_name, '')) LIKE '%.crdownload'
          OR lower(coalesce(representation, '')) = 'crdownload' THEN 'unsupported_type'
        WHEN kind = 'file_version'
         AND NOT wiki_reads_file_format(mime, file_name, representation)
            THEN 'unsupported_type'
        WHEN text_status = 'unsupported' THEN 'unsupported_type'
        WHEN text_status = 'too_large' THEN 'too_large'
        WHEN text_status = 'failed' THEN 'unreadable'
        WHEN text_status = 'no_text' AND kind = 'file_version'
         AND (lower(trim(split_part(mime, ';', 1))) = 'application/pdf'
              OR lower(file_name) LIKE '%.pdf'
              OR lower(representation) = 'pdf') THEN 'scanned'
        WHEN text_status = 'no_text' OR text_bytes = 0 THEN 'no_text'
        WHEN line_bytes > 144000 THEN 'too_large'
    END
$$;
-- +goose StatementEnd

CREATE VIEW public.wiki_document_verdicts AS
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

CREATE VIEW public.wiki_current_sources AS
 SELECT verdict.wiki_id,
    verdict.tenant_id,
    'document'::text AS source_kind,
    verdict.document_id AS source_id,
    verdict.version_id,
    verdict.size_bytes
   FROM public.wiki_document_verdicts verdict
  WHERE (verdict.reason IS NULL)
UNION ALL
 SELECT wiki_session_sources.wiki_id,
    wiki_session_sources.tenant_id,
    'session'::text AS source_kind,
    wiki_session_sources.source_id,
    wiki_session_sources.version_id,
    wiki_session_sources.size_bytes
   FROM public.wiki_session_sources;

-- +goose Down
-- The converted texts stay converted; their Documents keep the texts the
-- current normalizer gives.
DROP VIEW public.wiki_current_sources;
DROP VIEW public.wiki_document_verdicts;
DROP FUNCTION public.source_rejection_reason(text, text, text, text, text, text, bigint, bigint);
ALTER TABLE document_texts ADD COLUMN scanned boolean DEFAULT false NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION public.source_rejection_reason(import_status text, file_name text, representation text, kind text, mime text, text_status text, is_scanned boolean, text_bytes bigint, line_bytes bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT
    CASE
        WHEN import_status = 'failed' THEN 'unreadable'
        WHEN lower(coalesce(file_name, '')) LIKE '%.crdownload'
          OR lower(coalesce(representation, '')) = 'crdownload' THEN 'unsupported_type'
        WHEN kind = 'file_version'
         AND NOT wiki_reads_file_format(mime, file_name, representation)
            THEN 'unsupported_type'
        WHEN text_status = 'unsupported' THEN 'unsupported_type'
        WHEN text_status = 'too_large' THEN 'too_large'
        WHEN text_status = 'failed' THEN 'unreadable'
        WHEN is_scanned THEN 'scanned'
        WHEN text_status = 'no_text' AND kind = 'file_version'
         AND (lower(trim(split_part(mime, ';', 1))) = 'application/pdf'
              OR lower(file_name) LIKE '%.pdf'
              OR lower(representation) = 'pdf') THEN 'scanned'
        WHEN text_status = 'no_text' OR text_bytes = 0 THEN 'no_text'
        WHEN line_bytes > 144000 THEN 'too_large'
    END
$$;
-- +goose StatementEnd

CREATE VIEW public.wiki_document_verdicts AS
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
    public.source_rejection_reason(document.native_import_status, version.filename, version.representation_format, text.source_kind, version.media_type, text.status, text.scanned, (octet_length(text.markdown))::bigint, text.longest_line_bytes) AS reason
   FROM (((((public.document_context_bindings binding
     JOIN public.documents document ON (((document.id = binding.document_id) AND (document.tenant_id = binding.tenant_id) AND (document.status = 'active'::text))))
     JOIN public.document_texts text ON ((text.document_id = document.id)))
     LEFT JOIN public.document_versions version ON (((text.source_kind = 'file_version'::text) AND (version.id = text.source_id) AND (version.document_id = document.id))))
     LEFT JOIN public.wiki_source_items item ON (((item.tenant_id = document.tenant_id) AND (item.document_id = document.id))))
     LEFT JOIN public.external_connections connection ON ((connection.id = split_part(item.source_key, ':'::text, 2))))
  WHERE ((binding.binding_kind = 'wiki_source'::text) AND (binding.status = 'active'::text) AND (COALESCE(document.native_import_status, 'completed'::text) = ANY (ARRAY['completed'::text, 'failed'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.document_context_bindings page
          WHERE ((page.document_id = document.id) AND (page.tenant_id = document.tenant_id) AND (page.binding_kind = 'wiki_page'::text))))));

CREATE VIEW public.wiki_current_sources AS
 SELECT verdict.wiki_id,
    verdict.tenant_id,
    'document'::text AS source_kind,
    verdict.document_id AS source_id,
    verdict.version_id,
    verdict.size_bytes
   FROM public.wiki_document_verdicts verdict
  WHERE (verdict.reason IS NULL)
UNION ALL
 SELECT wiki_session_sources.wiki_id,
    wiki_session_sources.tenant_id,
    'session'::text AS source_kind,
    wiki_session_sources.source_id,
    wiki_session_sources.version_id,
    wiki_session_sources.size_bytes
   FROM public.wiki_session_sources;
