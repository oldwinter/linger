import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubPocketNotePage } from "@/features/teamhub/teamhub-types";

import { appendToPocketNote } from "./pocket-notes/pocket-note-append";
import {
  pocketNotesQueryKey,
  pocketNotesQueryOptions,
  storeTodayPocketNote,
} from "./pocket-notes/pocket-note-queries";

type PocketNotesData = InfiniteData<TeamHubPocketNotePage, string | undefined>;

/**
 * Puts the finished catch-up on today's Pocket Note. A second keep of the same
 * block does not write it again.
 */
export async function keepCatchUpInPocket(input: {
  client: TeamHubClient;
  note: string;
  queryClient: QueryClient;
  tenantId: string;
}): Promise<"kept" | "already"> {
  const cached = input.queryClient.getQueryData<PocketNotesData>(
    pocketNotesQueryKey(input.tenantId),
  );
  const data =
    cached ??
    (await input.queryClient.fetchInfiniteQuery(
      pocketNotesQueryOptions(input.client, input.tenantId),
    ));
  const today = data.pages[0]?.today;
  const current =
    data.pages.flatMap((page) => page.items).find((item) => item.date === today)
      ?.text ?? "";
  if (current.includes(input.note)) return "already";
  const text = appendToPocketNote(current, input.note);
  const saved = await teamHubData(
    input.client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
      body: { text },
      params: { path: { tenantId: input.tenantId } },
    }),
  );
  storeTodayPocketNote(input.queryClient, input.tenantId, saved);
  return "kept";
}
