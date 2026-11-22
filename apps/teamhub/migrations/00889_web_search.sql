-- +goose Up
-- Web search API keys saved in the product, one row per backend, sealed with
-- TEAMHUB_SECRET_ENCRYPTION_KEY like voice_provider_keys. A key serves every
-- Human and Agent on the deployment, and TeamHub reads the row at each call,
-- so a save applies on every replica at once. state is what the provider last
-- said about the key: verified by its official check or a successful call,
-- unverified while a provider without an official check (Brave, Exa) has answered
-- no call yet, rejected once it refused the key. The quota columns keep the
-- last rate-limit headers of a provider that reports quota only on its
-- responses; a save clears them.
CREATE TABLE web_search_keys (
    backend text PRIMARY KEY CHECK (backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa')),
    api_key_ciphertext bytea NOT NULL,
    state text NOT NULL CHECK (state IN ('verified', 'unverified', 'rejected')),
    quota_remaining double precision,
    quota_limit double precision,
    quota_resets_at timestamp with time zone,
    quota_observed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- The deployment's default web search backend: at most one row. Without a
-- row or a value, a search uses the first usable backend in TeamHub's order.
CREATE TABLE web_search_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    default_backend text CHECK (default_backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa', 'duckduckgo')),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- A search_key card asks a Human for a web search API key; saving any web
-- search key answers it.
ALTER TABLE decisions DROP CONSTRAINT decisions_kind_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_kind_check CHECK (kind = ANY (ARRAY[
    'connector_write', 'agent_change', 'question', 'runtime_permission', 'profile_setup_apps',
    'profile_setup_sources', 'connection_auth', 'provider_key', 'browser_connection',
    'room_creation', 'computer_permission', 'search_key'
]));

-- +goose Down
DELETE FROM decisions WHERE kind = 'search_key';
ALTER TABLE decisions DROP CONSTRAINT decisions_kind_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_kind_check CHECK (kind = ANY (ARRAY[
    'connector_write', 'agent_change', 'question', 'runtime_permission', 'profile_setup_apps',
    'profile_setup_sources', 'connection_auth', 'provider_key', 'browser_connection',
    'room_creation', 'computer_permission'
]));
DROP TABLE web_search_settings;
DROP TABLE web_search_keys;
