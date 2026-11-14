import {
  matchesSearchQuery,
  normalizeSearchQuery,
} from "@/features/search/search-text";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

export interface PocketNoteSearchResult {
  /** Whether any loaded note matched, so the panel knows to offer clearing. */
  matched: boolean;
  items: TeamHubPocketNote[];
}

/**
 * The notes whose date or readable text holds every word of the query,
 * case-insensitively. An empty query keeps every loaded note, and matching
 * stays on the readable text so Markdown markers are never a search word.
 */
export function searchPocketNotes(
  notes: readonly TeamHubPocketNote[],
  query: string,
): PocketNoteSearchResult {
  const words = normalizeSearchQuery(query).split(/\s+/u).filter(Boolean);
  if (!words.length) return { items: [...notes], matched: true };
  const items = notes.filter((note) =>
    words.every((word) =>
      matchesSearchQuery(word, [note.date, markdownPlainText(note.text)]),
    ),
  );
  return { items, matched: items.length > 0 };
}
