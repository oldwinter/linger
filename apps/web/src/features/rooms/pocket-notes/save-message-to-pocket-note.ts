import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubCurrentIdentity,
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";

import { messageQuoteText } from "../chat/message-quote";
import { appendToPocketNote } from "./pocket-note-append";
import {
  broadcastPocketNoteChannelUpdate,
  fetchTodayPocketNote,
  isPocketNoteConflictError,
  pocketNoteExpectedUpdatedAt,
  pocketNotesQueryKey,
  pocketNotesQueryOptions,
  storeTodayPocketNote,
} from "./pocket-note-queries";

type PocketNotesData = InfiniteData<TeamHubPocketNotePage, string | undefined>;

const maxConflictRetries = 4;

interface SaveMessageInput {
  accountId?: string;
  authorName?: string | null;
  client: TeamHubClient;
  createdAt: string;
  message: { id: string; raw_message: string };
  queryClient: QueryClient;
  tenantId: string;
}

const pendingSaves = new Map<string, Promise<TeamHubPocketNote>>();
const tenantWriteQueues = new Map<string, Promise<void>>();

/**
 * Appends one Message to today's Pocket Note as a quoted block.
 *
 * Uses TeamHub's optimistic concurrency precondition (`expected_updated_at`)
 * with bounded conflict retries so concurrent edits from open tabs or the
 * Pocket Note editor are preserved rather than silently overwritten.
 * A second save of the same Message joins the request already in flight.
 */
export function saveMessageToPocketNote(
  input: SaveMessageInput,
): Promise<TeamHubPocketNote> {
  const key = `${input.tenantId}\n${input.message.id}`;
  const pending = pendingSaves.get(key);
  if (pending) return pending;
  const save = serializeTenantWrite(input.tenantId, () =>
    appendToTodayPage(input),
  ).finally(() => {
    pendingSaves.delete(key);
  });
  pendingSaves.set(key, save);
  return save;
}

function serializeTenantWrite<T>(
  tenantId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tenantWriteQueues.get(tenantId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tenantWriteQueues.set(tenantId, tail);
  void tail.finally(() => {
    if (tenantWriteQueues.get(tenantId) === tail) {
      tenantWriteQueues.delete(tenantId);
    }
  });
  return result;
}

async function appendToTodayPage(
  input: SaveMessageInput,
): Promise<TeamHubPocketNote> {
  const quote = messageQuoteText({
    authorName: input.authorName,
    createdAt: input.createdAt,
    message: input.message.raw_message,
  });
  const accountId =
    input.accountId ??
    input.queryClient.getQueryData<TeamHubCurrentIdentity>(
      teamHubIdentityQueryKey,
    )?.account.id;
  let snapshot = await initialTodaySnapshot(input);
  for (let attempt = 0; attempt < maxConflictRetries; attempt += 1) {
    const trimmedQuote = quote.trim();
    const text =
      trimmedQuote && snapshot.text.includes(trimmedQuote)
        ? snapshot.text
        : appendToPocketNote(snapshot.text, quote);
    try {
      const note = await teamHubData(
        input.client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
          params: { path: { tenantId: input.tenantId } },
          body: {
            text,
            ...(snapshot.expectedUpdatedAt !== undefined
              ? { expected_updated_at: snapshot.expectedUpdatedAt }
              : {}),
          },
        }),
      );
      storeTodayPocketNote(input.queryClient, input.tenantId, note);
      broadcastPocketNoteChannelUpdate({
        accountId,
        note,
        tenantId: input.tenantId,
      });
      return note;
    } catch (error) {
      if (
        !isPocketNoteConflictError(error) ||
        attempt + 1 >= maxConflictRetries
      ) {
        throw error;
      }
      const latest = await fetchTodayPocketNote(
        input.client,
        input.queryClient,
        input.tenantId,
      );
      snapshot = {
        expectedUpdatedAt: pocketNoteExpectedUpdatedAt(latest.note),
        text: latest.note?.text ?? "",
      };
    }
  }
  throw new Error("Pocket Note conflict retries exhausted.");
}

/** The cached page when the notepad has loaded, otherwise one read of it. */
async function initialTodaySnapshot(input: SaveMessageInput): Promise<{
  expectedUpdatedAt: string | undefined;
  text: string;
}> {
  const cached = input.queryClient.getQueryData<PocketNotesData>(
    pocketNotesQueryKey(input.tenantId),
  );
  const data =
    cached ??
    (await input.queryClient.fetchInfiniteQuery(
      pocketNotesQueryOptions(input.client, input.tenantId),
    ));
  const today = data.pages[0]?.today;
  const note = data.pages
    .flatMap((page) => page.items)
    .find((item) => item.date === today);
  return {
    expectedUpdatedAt: pocketNoteExpectedUpdatedAt(note),
    text: note?.text ?? "",
  };
}
