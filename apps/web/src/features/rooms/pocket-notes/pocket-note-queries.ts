import {
  infiniteQueryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { teamHubQueryRoot } from "@/features/rooms/room-queries";
import type {
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";

type PocketNotesData = InfiniteData<TeamHubPocketNotePage, string | undefined>;

export const POCKET_NOTE_CONFLICT_CODE = "POCKET_NOTE_CONFLICT";
export const POCKET_NOTE_SYNC_CHANNEL = "linger.pocket-notes:v1";

export const pocketNoteTabSenderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function isPocketNoteConflictError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "TeamHubError" &&
    "status" in error &&
    error.status === 409 &&
    "code" in error &&
    error.code === POCKET_NOTE_CONFLICT_CODE
  );
}

/**
 * The optimistic-concurrency token TeamHub expects for today's page: the
 * stored row's `updated_at`, or `""` when today's page is empty (no row).
 */
export function pocketNoteExpectedUpdatedAt(
  note: Pick<TeamHubPocketNote, "text" | "updated_at"> | undefined,
): string | undefined {
  if (!note || note.text === "") return "";
  return note.updated_at || undefined;
}

export function resolvePocketNoteBroadcastChannel():
  | typeof BroadcastChannel
  | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel !== "function"
  ) {
    return undefined;
  }
  const Channel = window.BroadcastChannel;
  // Node's worker_threads BroadcastChannel exposes ref/unref and crosses
  // parallel test workers instead of staying scoped to one browser origin.
  if (
    typeof Channel.prototype === "object" &&
    Channel.prototype !== null &&
    "unref" in Channel.prototype
  ) {
    return undefined;
  }
  return Channel;
}

/** Notifies other open tabs of the same account and tenant via BroadcastChannel. */
export function broadcastPocketNoteChannelUpdate(input: {
  accountId?: string;
  note: TeamHubPocketNote;
  tenantId: string;
}): void {
  const { accountId, note, tenantId } = input;
  if (!accountId || !tenantId || !note.date) return;
  const Channel = resolvePocketNoteBroadcastChannel();
  if (!Channel) return;
  try {
    const channel = new Channel(POCKET_NOTE_SYNC_CHANNEL);
    channel.postMessage({
      accountId,
      note,
      senderId: pocketNoteTabSenderId,
      tenantId,
    });
    channel.close();
  } catch {
    // Ignore restricted channel contexts; optimistic concurrency still guards writes.
  }
}

export function pocketNotesQueryKey(tenantId: string) {
  return [...teamHubQueryRoot, tenantId, "pocket-notes"] as const;
}

export function pocketNotesQueryOptions(
  client: TeamHubClient,
  tenantId: string,
) {
  return infiniteQueryOptions({
    getNextPageParam: (page: TeamHubPocketNotePage) =>
      page.page.has_more ? page.page.next_cursor : undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
          params: { path: { tenantId }, query: { cursor: pageParam } },
        }),
      ),
    queryKey: pocketNotesQueryKey(tenantId),
    // The page list decides which day is "today", so refresh it whenever the
    // notepad opens again instead of trusting a page cached before midnight.
    staleTime: 0,
  });
}

/** Replaces the first page in the cached list while keeping older pages intact. */
export function replacePocketNotesFirstPage(
  queryClient: QueryClient,
  tenantId: string,
  firstPage: TeamHubPocketNotePage,
) {
  queryClient.setQueryData<PocketNotesData>(
    pocketNotesQueryKey(tenantId),
    (data) => {
      if (!data || data.pages.length === 0) {
        return { pageParams: [undefined], pages: [firstPage] };
      }
      const firstDates = new Set(firstPage.items.map((item) => item.date));
      const rest = data.pages.slice(1).map((page) => ({
        ...page,
        items: page.items.filter((item) => !firstDates.has(item.date)),
      }));
      return { ...data, pages: [firstPage, ...rest] };
    },
  );
}

/**
 * Fetches the authoritative first page of Pocket Notes from TeamHub, updates
 * the query cache, and returns today's stored page if one exists.
 */
export async function fetchTodayPocketNote(
  client: TeamHubClient,
  queryClient: QueryClient,
  tenantId: string,
): Promise<{ note?: TeamHubPocketNote; today: string }> {
  const firstPage = await teamHubData(
    client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
      params: { path: { tenantId } },
    }),
  );
  replacePocketNotesFirstPage(queryClient, tenantId, firstPage);
  return {
    note: firstPage.items.find((item) => item.date === firstPage.today),
    today: firstPage.today,
  };
}

/** Writes today's page into the cached list: newest first, empty pages dropped. */
export function storeTodayPocketNote(
  queryClient: QueryClient,
  tenantId: string,
  note: TeamHubPocketNote,
) {
  queryClient.setQueryData<PocketNotesData>(
    pocketNotesQueryKey(tenantId),
    (data) => {
      if (!data) return data;
      const pages = data.pages.map((page, index) => {
        const items = page.items.filter((item) => item.date !== note.date);
        return index === 0 && note.text
          ? { ...page, items: [note, ...items] }
          : { ...page, items };
      });
      return { ...data, pages };
    },
  );
}

/** Drops a deleted past day from the cached list. */
export function removePocketNote(
  queryClient: QueryClient,
  tenantId: string,
  date: string,
) {
  queryClient.setQueryData<PocketNotesData>(
    pocketNotesQueryKey(tenantId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.date !== date),
        })),
      },
  );
}
