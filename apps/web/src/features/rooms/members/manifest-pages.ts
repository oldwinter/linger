export interface ManifestPage<T> {
  items: T[];
  page: { has_more: boolean; next_cursor?: string };
}

/** Collects every cursor page from a TeamHub manifest list endpoint. */
export async function loadAllManifestPages<T>(
  loadPage: (page: {
    cursor?: string;
    limit: number;
  }) => Promise<ManifestPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const current = await loadPage({ cursor, limit: 100 });
    items.push(...current.items);
    if (!current.page.has_more) return items;

    const nextCursor = current.page.next_cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("TeamHub returned an invalid catalog cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return items;
}
