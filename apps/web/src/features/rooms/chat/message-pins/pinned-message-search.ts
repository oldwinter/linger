import {
  matchesSearchQuery,
  normalizeSearchQuery,
} from "@/features/search/search-text";

/** What the Pinned panel shows of a pin: its Message text and author. */
export interface PinnedMessageSearchTarget {
  message: {
    author: { display_name: string };
    raw_message: string;
  };
}

export interface PinnedMessageSearchResult<Pin> {
  count: number;
  /** The matching pins in their existing order. */
  items: Pin[];
}

/**
 * The pins whose Message text or author holds every word of the query,
 * case-insensitively. An empty query keeps every pin, so clearing restores the
 * list the panel showed before.
 */
export function searchPinnedMessages<Pin extends PinnedMessageSearchTarget>(
  pins: readonly Pin[],
  query: string,
): PinnedMessageSearchResult<Pin> {
  const words = normalizeSearchQuery(query).split(/\s+/u).filter(Boolean);
  const items = words.length
    ? pins.filter((pin) =>
        words.every((word) =>
          matchesSearchQuery(word, [
            pin.message.raw_message,
            pin.message.author.display_name,
          ]),
        ),
      )
    : [...pins];
  return { count: items.length, items };
}
