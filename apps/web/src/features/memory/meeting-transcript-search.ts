export interface MeetingTranscriptMatch {
  /** Indices of the turns holding every query word, in spoken order. */
  indices: number[];
  count: number;
  /** The lowercased words a mark covers. */
  words: string[];
}

/**
 * Scores a transcript's turns against a query the way report search scores
 * report text: trimmed and case-insensitive, with every word required in the
 * same turn. An empty query matches nothing and is not an error.
 */
export function searchMeetingTranscript(
  turns: readonly string[],
  query: string,
): MeetingTranscriptMatch {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return { count: 0, indices: [], words };
  const indices: number[] = [];
  turns.forEach((turn, index) => {
    const text = turn.toLowerCase();
    if (words.every((word) => text.includes(word))) indices.push(index);
  });
  return { count: indices.length, indices, words };
}

/** Moving past the last match wraps to the first. */
export function nextMatchPosition(position: number, count: number): number {
  return count > 0 ? (position + 1) % count : 0;
}

/** Moving before the first match wraps to the last. */
export function previousMatchPosition(position: number, count: number): number {
  return count > 0 ? (position - 1 + count) % count : 0;
}
