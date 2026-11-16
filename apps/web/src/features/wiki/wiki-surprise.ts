/**
 * The index of a random Wiki page to open, or undefined when there is none.
 * With more than one page the page already on screen is skipped, so the action
 * always takes the reader somewhere new. `random` is passed in so a caller can
 * make the choice repeatable.
 */
export function wikiSurpriseIndex(input: {
  count: number;
  /** Position of the page on screen, when the action sits beside one. */
  currentIndex?: number;
  random: () => number;
}): number | undefined {
  const { count, currentIndex, random } = input;
  if (count <= 0) return undefined;
  if (count === 1) return 0;
  const skip =
    currentIndex !== undefined && currentIndex >= 0 && currentIndex < count
      ? currentIndex
      : undefined;
  const candidates = skip === undefined ? count : count - 1;
  const pick = Math.min(Math.floor(random() * candidates), candidates - 1);
  return skip !== undefined && pick >= skip ? pick + 1 : pick;
}

const seenKey = (tenantId: string) =>
  `linger.wiki-surprise-seen.${encodeURIComponent(tenantId)}`;

export function readWikiSurpriseSeen(tenantId: string): string[] {
  try {
    const raw = sessionStorage.getItem(seenKey(tenantId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeWikiSurpriseSeen(
  tenantId: string,
  seenIds: readonly string[],
) {
  try {
    sessionStorage.setItem(seenKey(tenantId), JSON.stringify(seenIds));
  } catch {
    // A blocked store still opens a page; the next click may repeat.
  }
}

/**
 * Opens a listed page that this round has not opened yet. When every listed
 * page has been opened, the next round starts and still will not repeat the
 * page just opened if another page exists.
 */
export function nextWikiSurprise<T extends { id: string }>(
  pages: readonly T[],
  seenIds: readonly string[],
  random: () => number,
): { page: T; seenIds: string[] } | undefined {
  if (pages.length === 0) return undefined;
  const listed = new Set(pages.map((page) => page.id));
  const remembered = seenIds.filter((id) => listed.has(id));
  let pool = pages.filter((page) => !remembered.includes(page.id));
  let round = remembered;
  if (pool.length === 0) {
    const last = remembered.at(-1);
    pool =
      pages.length > 1 && last !== undefined
        ? pages.filter((page) => page.id !== last)
        : [...pages];
    round = [];
  }
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  const page = pool[index];
  if (!page) return undefined;
  return { page, seenIds: [...round, page.id] };
}
