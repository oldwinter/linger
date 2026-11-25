import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

export function noteFromThatDay(
  notes: readonly { date: string; text: string }[],
  day: string,
): string | undefined {
  const note = notes.find((item) => item.date === day);
  const text = note?.text.trim();
  return text ? text : undefined;
}

/**
 * The Pocket note for one calendar day. Notes are newest first, so paging
 * stops once a page is entirely older than the day.
 */
export async function loadNoteFromThatDay(
  client: TeamHubClient,
  tenantId: string,
  day: string,
): Promise<string | null> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const page = await teamHubData(
      client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
        params: {
          path: { tenantId },
          query: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    const match = page.items.find((item) => item.date === day);
    if (match) return noteFromThatDay([match], day) ?? null;
    const oldest = page.items.at(-1)?.date;
    if (
      (oldest && oldest < day) ||
      !page.page.has_more ||
      !page.page.next_cursor ||
      seen.has(page.page.next_cursor)
    ) {
      return null;
    }
    seen.add(page.page.next_cursor);
    cursor = page.page.next_cursor;
  }
}
