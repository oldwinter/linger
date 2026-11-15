import { Fragment, type ReactNode } from "react";

/** Wrap every case-insensitive occurrence of the query's words in <mark>. */
export function HighlightedText({
  query,
  text,
}: {
  query: string;
  text: string;
}): ReactNode {
  const words = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return text;
  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = earliestMatch(lower, words, cursor);
    if (!match) break;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(
      <mark
        className="rounded-sm bg-(--app-comment-highlight)/25 px-px text-foreground"
        key={`${match.index}-${parts.length}`}
      >
        {text.slice(match.index, match.index + match.length)}
      </mark>,
    );
    cursor = match.index + match.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.map((part, position) => (
    <Fragment key={position}>{part}</Fragment>
  ));
}

/** The leftmost occurrence of any word, preferring the longer word at a tie. */
function earliestMatch(text: string, words: readonly string[], from: number) {
  let found: { index: number; length: number } | undefined;
  for (const word of words) {
    const index = text.indexOf(word, from);
    if (index < 0) continue;
    if (
      !found ||
      index < found.index ||
      (index === found.index && word.length > found.length)
    ) {
      found = { index, length: word.length };
    }
  }
  return found;
}
