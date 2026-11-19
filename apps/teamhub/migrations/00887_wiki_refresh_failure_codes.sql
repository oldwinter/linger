-- +goose Up
-- Carry structured Computer and Runtime failure codes on Wiki refreshes so the
-- Wiki status banner can surface actionable causes such as runtime_incompatible.
ALTER TABLE public.document_wiki_refreshes
    DROP CONSTRAINT document_wiki_refreshes_dispatch_last_error_code_check;

ALTER TABLE public.document_wiki_refreshes
    ADD CONSTRAINT document_wiki_refreshes_dispatch_last_error_code_check CHECK (
        dispatch_last_error_code IS NULL OR dispatch_last_error_code = ANY (ARRAY[
            'object_unavailable'::text,
            'object_mismatch'::text,
            'candidate_unavailable'::text,
            'candidate_invalid'::text,
            'settlement_unavailable'::text,
            'computer_offline'::text,
            'runtime_incompatible'::text,
            'runtime_auth_required'::text,
            'runtime_unavailable'::text
        ])
    );

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'wiki refresh failure codes migration is forward-only'; END $$;
-- +goose StatementEnd
