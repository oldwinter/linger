import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";

import { messageQuoteText } from "../chat/message-quote";
import { appendToPocketNote } from "./pocket-note-append";
import {
  pocketNotesQueryKey,
  pocketNotesQueryOptions,
  storeTodayPocketNote,
} from "./pocket-note-queries";

type PocketNotesData = InfiniteData<TeamHubPocketNotePage, string | undefined>;

interface SaveMessageInput {
  authorName?: string | null;
  client: TeamHubClient;
  createdAt: string;
  message: { id: string; raw_message: string };
  queryClient: QueryClient;
  tenantId: string;
}

const pendingSaves = new Map<string, Promise<TeamHubPocketNote>>();

/**
 * Appends one Message to today's Pocket Note as a quoted block.
 *
 * The PUT replaces the whole page and the contract carries no idempotency
 * field, so the key lives here: a second save of the same Message joins the
 * request already in flight instead of appending the quote twice.
 */
export function saveMessageToPocketNote(
  input: SaveMessageInput,
): Promise<TeamHubPocketNote> {
  const key = `${input.tenantId}\n${input.message.id}`;
  const pending = pendingSaves.get(key);
  if (pending) return pending;
  const save = appendToTodayPage(input).finally(() => {
    pendingSaves.delete(key);
  });
  pendingSaves.set(key, save);
  return save;
}

async function appendToTodayPage(
  input: SaveMessageInput,
): Promise<TeamHubPocketNote> {
  const text = appendToPocketNote(
    await todayPageText(input),
    messageQuoteText({
      authorName: input.authorName,
      createdAt: input.createdAt,
      message: input.message.raw_message,
    }),
  );
  const note = await teamHubData(
    input.client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
      params: { path: { tenantId: input.tenantId } },
      body: { text },
    }),
  );
  storeTodayPocketNote(input.queryClient, input.tenantId, note);
  return note;
}

/** The cached page when the notepad has loaded, otherwise one read of it. */
async function todayPageText(input: SaveMessageInput): Promise<string> {
  const cached = input.queryClient.getQueryData<PocketNotesData>(
    pocketNotesQueryKey(input.tenantId),
  );
  const data =
    cached ??
    (await input.queryClient.fetchInfiniteQuery(
      pocketNotesQueryOptions(input.client, input.tenantId),
    ));
  const today = data.pages[0]?.today;
  return (
    data.pages.flatMap((page) => page.items).find((item) => item.date === today)
      ?.text ?? ""
  );
}
