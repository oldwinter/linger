import type { components } from "@linger/wire-contracts/teamhub-public/types";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { personalWikiDocumentsQueryKey } from "@/features/teamhub/document-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

export type WikiRefreshFailureReason =
  components["schemas"]["PersonalWikiFailureReason"];

export interface WikiRefreshStatus {
  preview?: Record<string, string>;
  failed: boolean;
  failureReason?: WikiRefreshFailureReason;
  hasPublishedWiki: boolean;
  initializing: boolean;
  refetchStatus: () => Promise<unknown>;
  refreshing: boolean;
  statusError: Error | null;
  statusFetching: boolean;
  statusPending: boolean;
}

const wikiRefreshPollIntervalMs = 2_000;

/** Reloads everything a finished refresh changes, whoever started it. */
function invalidateWikiAfterRefresh(
  queryClient: QueryClient,
  tenantId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: ["teamhub", tenantId, "personal-wiki"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["teamhub", tenantId, "personal-memory"],
  });
  void queryClient.invalidateQueries({
    queryKey: personalWikiDocumentsQueryKey(tenantId),
  });
}

/**
 * Asks TeamHub to refresh the Wiki now. The running state, the pages, and the
 * polling that follows come from the same queries as a server-started refresh.
 */
export function useRequestWikiRefresh(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      teamHubData(
        client.api.POST("/v0/tenants/{tenantId}/personal-wiki/refresh", {
          params: { path: { tenantId } },
        }),
      ),
    onSuccess: () => invalidateWikiAfterRefresh(queryClient, tenantId),
  });
}

/**
 * Observes the refreshes the server runs on its own (after a meeting, the
 * nightly refresh, initialization): polls the Wiki status while one runs and
 * reloads the Wiki and Memory once it completes.
 */
export function usePersonalWikiRefresh(tenantId: string): WikiRefreshStatus {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const refreshStateSeen = useRef(false);
  const seenGeneration = useRef<number | undefined>(undefined);
  const wiki = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/personal-wiki", {
          params: { path: { tenantId } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "personal-wiki", "status"],
    refetchInterval: (query) =>
      query.state.data?.state === "refreshing"
        ? wikiRefreshPollIntervalMs
        : 30_000,
  });
  const refreshing = wiki.data?.state === "refreshing";

  const refreshId = wiki.data?.latest_refresh_id;
  const revision = wiki.data?.preview_revision;
  const preview = useQuery({
    enabled: Boolean(refreshing && refreshId && revision),
    queryKey: [
      "teamhub",
      tenantId,
      "personal-wiki-preview",
      refreshId,
      revision,
    ],
    gcTime: 0,
    placeholderData: (previous, query) =>
      query && query.queryKey[3] === refreshId && query.queryKey[1] === tenantId
        ? previous
        : undefined,
    queryFn: async () => {
      const response = await client.api.GET(
        "/v0/tenants/{tenantId}/personal-wiki/preview",
        {
          params: { path: { tenantId }, query: { refresh_id: refreshId! } },
        },
      );
      if (!response.data) throw new Error("Wiki preview unavailable");
      return response.data;
    },
  });

  useEffect(() => {
    const generation = wiki.data?.published_generation;
    if (generation === undefined) return;
    const published =
      seenGeneration.current !== undefined &&
      generation !== seenGeneration.current;
    const ended = refreshStateSeen.current && !refreshing;
    seenGeneration.current = generation;
    refreshStateSeen.current = refreshing;
    if (!published && !ended) return;
    invalidateWikiAfterRefresh(queryClient, tenantId);
  }, [queryClient, refreshing, tenantId, wiki.data?.published_generation]);

  return {
    preview: refreshing && revision ? preview.data : undefined,
    failed: wiki.data?.state === "failed",
    failureReason:
      wiki.data?.state === "failed" ? wiki.data.failure_reason : undefined,
    hasPublishedWiki: (wiki.data?.published_generation ?? 0) > 0,
    initializing: refreshing && wiki.data?.published_generation === 0,
    refetchStatus: () => wiki.refetch(),
    refreshing,
    statusError: wiki.error,
    statusFetching: wiki.isFetching,
    statusPending: wiki.isPending,
  };
}
