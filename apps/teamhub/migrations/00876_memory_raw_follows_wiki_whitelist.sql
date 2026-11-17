-- +goose Up
-- My pages and imported mail enter the Memory index only when the Wiki
-- whitelist would admit them. Sources already indexed that no longer qualify
-- leave the index on Memory's next hourly reconciliation, which deletes every
-- My pages or mail source missing from this inventory with its chunks and
-- facts.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION memory_source.personal_documents(p_tenant_id text, p_owner_actor_id text) RETURNS TABLE(folder_path text, origin_kind text, document_id text, text_source_kind text, text_source_id text, title text, filename text, media_type text, markdown_sha256 text, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
WITH RECURSIVE tree AS (
    SELECT placement.id, placement.parent_id, placement.node_kind,
        placement.name, placement.document_id,
        CASE WHEN placement.node_kind = 'folder' THEN placement.name ELSE '' END AS folder_path
    FROM document_placements placement
    WHERE placement.tenant_id = p_tenant_id
      AND placement.owner_human_actor_id = p_owner_actor_id
      AND placement.scope_kind = 'personal'
      AND placement.parent_id IS NULL
      AND placement.deleted_at IS NULL
    UNION ALL
    SELECT child.id, child.parent_id, child.node_kind, child.name,
        child.document_id,
        CASE WHEN child.node_kind = 'folder'
            THEN concat_ws('/', nullif(tree.folder_path, ''), child.name)
            ELSE tree.folder_path END
    FROM document_placements child
    JOIN tree ON tree.id = child.parent_id
    WHERE child.tenant_id = p_tenant_id
      AND child.owner_human_actor_id = p_owner_actor_id
      AND child.scope_kind = 'personal'
      AND child.deleted_at IS NULL
), candidates AS (
    SELECT tree.document_id, tree.folder_path, 'my_pages'::text AS origin_kind
    FROM tree
    WHERE tree.node_kind = 'document'
    UNION ALL
    SELECT item.document_id, '', 'mail'
    FROM wiki_source_items item
    JOIN document_context_bindings binding
      ON binding.document_id = item.document_id
     AND binding.tenant_id = item.tenant_id
     AND binding.binding_kind = 'wiki_source'
     AND binding.status = 'active'
    JOIN personal_wikis wiki
      ON wiki.id = binding.wiki_id
     AND wiki.tenant_id = item.tenant_id
     AND wiki.owner_actor_id = item.owner_actor_id
     AND wiki.deleted_at IS NULL
    WHERE item.tenant_id = p_tenant_id
      AND item.owner_actor_id = p_owner_actor_id
), current_documents AS (
    SELECT DISTINCT ON (candidates.document_id)
        candidates.document_id, candidates.folder_path, candidates.origin_kind
    FROM candidates
    ORDER BY candidates.document_id, candidates.origin_kind, candidates.folder_path
)
SELECT current_documents.folder_path,
    current_documents.origin_kind,
    document.id,
    text.source_kind,
    text.source_id,
    document.title,
    coalesce(version.filename, document.title),
    coalesce(version.media_type, 'text/markdown'),
    text.markdown_sha256,
    coalesce(version.created_at, text.updated_at)
FROM current_documents
JOIN documents document
  ON document.id = current_documents.document_id
 AND document.tenant_id = p_tenant_id
 AND document.status = 'active'
JOIN document_texts text
  ON text.document_id = document.id
 AND text.status = 'ready'
LEFT JOIN document_versions version
  ON text.source_kind = 'file_version'
 AND version.id = text.source_id
 AND version.document_id = document.id
WHERE NOT EXISTS (
    SELECT 1 FROM document_context_bindings page
    WHERE page.document_id = document.id AND page.tenant_id = document.tenant_id
      AND page.binding_kind = 'wiki_page')
  AND (text.source_kind = 'native_body'
       OR EXISTS (SELECT 1 FROM document_text_heads head
                  WHERE head.id = document.id AND head.tenant_id = document.tenant_id))
  -- Memory keeps only what the Wiki can record: the same rejection rule
  -- the Wiki whitelist applies keeps scans, images, spreadsheets, data and
  -- code files out of Raw.
  AND public.source_rejection_reason(document.native_import_status,
        version.filename, version.representation_format, text.source_kind,
        version.media_type, text.status,
        octet_length(text.markdown)::bigint, text.longest_line_bytes) IS NULL
ORDER BY current_documents.folder_path, document.id
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION memory_source.personal_documents(p_tenant_id text, p_owner_actor_id text) RETURNS TABLE(folder_path text, origin_kind text, document_id text, text_source_kind text, text_source_id text, title text, filename text, media_type text, markdown_sha256 text, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
WITH RECURSIVE tree AS (
    SELECT placement.id, placement.parent_id, placement.node_kind,
        placement.name, placement.document_id,
        CASE WHEN placement.node_kind = 'folder' THEN placement.name ELSE '' END AS folder_path
    FROM document_placements placement
    WHERE placement.tenant_id = p_tenant_id
      AND placement.owner_human_actor_id = p_owner_actor_id
      AND placement.scope_kind = 'personal'
      AND placement.parent_id IS NULL
      AND placement.deleted_at IS NULL
    UNION ALL
    SELECT child.id, child.parent_id, child.node_kind, child.name,
        child.document_id,
        CASE WHEN child.node_kind = 'folder'
            THEN concat_ws('/', nullif(tree.folder_path, ''), child.name)
            ELSE tree.folder_path END
    FROM document_placements child
    JOIN tree ON tree.id = child.parent_id
    WHERE child.tenant_id = p_tenant_id
      AND child.owner_human_actor_id = p_owner_actor_id
      AND child.scope_kind = 'personal'
      AND child.deleted_at IS NULL
), candidates AS (
    SELECT tree.document_id, tree.folder_path, 'my_pages'::text AS origin_kind
    FROM tree
    WHERE tree.node_kind = 'document'
    UNION ALL
    SELECT item.document_id, '', 'mail'
    FROM wiki_source_items item
    JOIN document_context_bindings binding
      ON binding.document_id = item.document_id
     AND binding.tenant_id = item.tenant_id
     AND binding.binding_kind = 'wiki_source'
     AND binding.status = 'active'
    JOIN personal_wikis wiki
      ON wiki.id = binding.wiki_id
     AND wiki.tenant_id = item.tenant_id
     AND wiki.owner_actor_id = item.owner_actor_id
     AND wiki.deleted_at IS NULL
    WHERE item.tenant_id = p_tenant_id
      AND item.owner_actor_id = p_owner_actor_id
), current_documents AS (
    SELECT DISTINCT ON (candidates.document_id)
        candidates.document_id, candidates.folder_path, candidates.origin_kind
    FROM candidates
    ORDER BY candidates.document_id, candidates.origin_kind, candidates.folder_path
)
SELECT current_documents.folder_path,
    current_documents.origin_kind,
    document.id,
    text.source_kind,
    text.source_id,
    document.title,
    coalesce(version.filename, document.title),
    coalesce(version.media_type, 'text/markdown'),
    text.markdown_sha256,
    coalesce(version.created_at, text.updated_at)
FROM current_documents
JOIN documents document
  ON document.id = current_documents.document_id
 AND document.tenant_id = p_tenant_id
 AND document.status = 'active'
JOIN document_texts text
  ON text.document_id = document.id
 AND text.status = 'ready'
LEFT JOIN document_versions version
  ON text.source_kind = 'file_version'
 AND version.id = text.source_id
 AND version.document_id = document.id
WHERE NOT EXISTS (
    SELECT 1 FROM document_context_bindings page
    WHERE page.document_id = document.id AND page.tenant_id = document.tenant_id
      AND page.binding_kind = 'wiki_page')
  AND (text.source_kind = 'native_body'
       OR EXISTS (SELECT 1 FROM document_text_heads head
                  WHERE head.id = document.id AND head.tenant_id = document.tenant_id))
ORDER BY current_documents.folder_path, document.id
$$;
-- +goose StatementEnd
