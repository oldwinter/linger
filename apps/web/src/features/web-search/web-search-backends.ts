import { queryOptions } from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubWebSearchBackend,
  TeamHubWebSearchKeyBackend,
  TeamHubWebSearchSearchBackend,
} from "@/features/teamhub/teamhub-types";

/** Every web search query; a saved key or default refreshes all of them. */
export const webSearchQueryKey = ["teamhub", "web-search"] as const;

/**
 * The backend list with each provider's live quota, for Connectors. Every
 * read asks the providers, so it is kept briefly.
 */
export function webSearchBackendsQueryOptions(client: TeamHubClient) {
  return queryOptions({
    queryKey: [...webSearchQueryKey, "backends", "quota"],
    queryFn: () => teamHubData(client.api.GET("/v0/web-search/backends")),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The same list without quota, which TeamHub answers without calling any
 * provider. The search key card shows only this static text.
 */
export function webSearchBackendInfoQueryOptions(client: TeamHubClient) {
  return queryOptions({
    queryKey: [...webSearchQueryKey, "backends", "info"],
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/web-search/backends", {
          params: { query: { include_quota: false } },
        }),
      ),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

const names: Record<TeamHubWebSearchKeyBackend, string> = {
  brave: "Brave Search",
  exa: "Exa",
  firecrawl: "Firecrawl",
  tavily: "Tavily",
  you: "You.com",
};

/**
 * A key backend's display name, for text written before the backend list
 * is read (a card's settled line, its notice). Rows use the list's `name`.
 */
export function webSearchBackendName(id: TeamHubWebSearchKeyBackend): string {
  return names[id];
}

/** Whether the backend takes an API key saved in the product. */
export function isWebSearchKeyBackend<T extends { id: string }>(
  backend: T,
): backend is T & { id: TeamHubWebSearchKeyBackend } {
  return backend.id in names;
}

/** The key page as a short label: host and path without `www.`. */
export function webSearchKeySite(keyURL: string): string {
  const url = new URL(keyURL);
  const path = url.pathname.replace(/\/$/, "");
  return `${url.host.replace(/^www\./, "")}${path}`;
}

/** A backend that searches, the ones Connectors shows. */
export type ShownWebSearchBackend = TeamHubWebSearchBackend & {
  id: TeamHubWebSearchSearchBackend;
};

/**
 * The backends Connectors shows: the ones that search. Direct only opens
 * pages and has nothing to set up.
 */
export function shownWebSearchBackends(
  backends: readonly TeamHubWebSearchBackend[],
) {
  return backends.filter(
    (backend): backend is ShownWebSearchBackend => backend.id !== "direct",
  );
}

/**
 * The backends Connected only keeps: a saved key, or a free tier that works
 * without one.
 */
export function connectedWebSearchBackends(
  backends: readonly TeamHubWebSearchBackend[],
) {
  return shownWebSearchBackends(backends).filter(
    (backend) => backend.key_state !== "none" || backend.tier === "free",
  );
}
