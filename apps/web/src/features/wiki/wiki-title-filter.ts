/**
 * The Wiki sidebar's filter rule: every word of the trimmed query appears in
 * the entry's title, ignoring case. An empty query keeps every entry.
 */
export function filterWikiEntries<T>(
  entries: readonly T[],
  query: string,
  titleOf: (entry: T) => string,
): readonly T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const title = titleOf(entry).toLocaleLowerCase();
    return words.every((word) => title.includes(word));
  });
}
