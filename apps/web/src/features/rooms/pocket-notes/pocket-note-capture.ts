import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";
import type { QueryClient } from "@tanstack/react-query";

import { storeTodayPocketNote } from "./pocket-note-queries";

/** TeamHub rejects a Pocket Note longer than this. */
export const POCKET_NOTE_TEXT_LIMIT = 20_000;

/** One captured line: who said it, then the words, on a single line. */
export function pocketCaptureLine(
  authorName: string,
  plainText: string,
): string {
  const body = plainText.replace(/\s+/gu, " ").trim();
  if (!body) return "";
  const name = authorName.trim() || "Someone";
  return `${name}: ${body}`;
}

/**
 * Today's note with the line added. `added` is false when that line is
 * already the last line, so a second save does not repeat it. Undefined
 * when the page would pass the text limit.
 */
export function withPocketCapture(
  current: string,
  line: string,
): { text: string; added: boolean } | undefined {
  if (!line) return;
  const base = current.replace(/\s+$/u, "");
  if (base === line || base.endsWith(`\n${line}`)) {
    return { text: base, added: false };
  }
  const text = base ? `${base}\n${line}` : line;
  if (text.length > POCKET_NOTE_TEXT_LIMIT) return;
  return { text, added: true };
}

export type PocketCaptureStatus = "saved" | "already" | "full";

/** Appends one line to today's Pocket Note. Today comes from TeamHub's clock. */
export async function saveMessageLineToPocket(
  client: TeamHubClient,
  queryClient: QueryClient | undefined,
  tenantId: string,
  line: string,
): Promise<PocketCaptureStatus> {
  const page = await teamHubData(
    client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
      params: { path: { tenantId } },
    }),
  );
  const current =
    page.items.find((item) => item.date === page.today)?.text ?? "";
  const next = withPocketCapture(current, line);
  if (!next) return "full";
  if (!next.added) return "already";
  const note: TeamHubPocketNote = await teamHubData(
    client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
      params: { path: { tenantId } },
      body: { text: next.text },
    }),
  );
  if (queryClient) storeTodayPocketNote(queryClient, tenantId, note);
  return "saved";
}
