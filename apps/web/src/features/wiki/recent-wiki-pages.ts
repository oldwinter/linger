import {
  removePreferenceKeys,
  storedPreferenceKeys,
} from "@/lib/local-preference-keys";

const RECENT_LIMIT = 5;
const STORAGE_PREFIX = "wiki-recent-pages.v1:";

/** One Wiki page this Account opened, as it was named and routed then. */
export interface RecentWikiPage {
  /** The page's Document id, or the preview page's key while unpublished. */
  id: string;
  name: string;
  /** The app route the entry reopens. */
  path: string;
  openedAt: string;
}

/**
 * The front of the list is the newest open, so reopening a page moves it there
 * instead of adding a second entry. An entry without an identity, a name or a
 * route could not be listed or reopened, so it never enters the list.
 */
export function addRecentWikiPage(
  entries: readonly RecentWikiPage[],
  entry: RecentWikiPage,
): RecentWikiPage[] {
  if (!usable(entry)) return entries.filter(usable);
  return [
    entry,
    ...entries.filter((other) => usable(other) && other.id !== entry.id),
  ].slice(0, RECENT_LIMIT);
}

/**
 * Reads the stored list for one Account. Unreadable JSON and entries that lost
 * their identity or route are dropped, so damaged storage cannot break the
 * Wiki home.
 */
export function readRecentWikiPages(
  accountId: string | undefined,
): RecentWikiPage[] {
  if (!accountId) return [];
  try {
    const stored = window.localStorage.getItem(storageKey(accountId));
    return parseRecentWikiPages(stored === null ? [] : JSON.parse(stored));
  } catch {
    return [];
  }
}

export function writeRecentWikiPages(
  accountId: string | undefined,
  entries: readonly RecentWikiPage[],
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(
      storageKey(accountId),
      JSON.stringify(entries.filter(usable).slice(0, RECENT_LIMIT)),
    );
  } catch {
    // Blocked storage keeps the list for this tab only.
  }
}

export function clearRecentWikiPages(accountId: string | undefined): void {
  if (!accountId) return;
  try {
    window.localStorage.removeItem(storageKey(accountId));
  } catch {
    // Blocked storage has nothing to clear.
  }
}

/** Whether this browser lists a recently opened Wiki page for any Account. */
export function hasRecentWikiPages(): boolean {
  return storedPreferenceKeys([STORAGE_PREFIX]).length > 0;
}

/** Clears the list for every Account in this browser. */
export function clearAllRecentWikiPages(): void {
  removePreferenceKeys([STORAGE_PREFIX]);
}

/** Records one open for the Account that opened it. */
export function recordRecentWikiPage(
  accountId: string | undefined,
  entry: RecentWikiPage,
): void {
  if (!accountId) return;
  writeRecentWikiPages(
    accountId,
    addRecentWikiPage(readRecentWikiPages(accountId), entry),
  );
}

function parseRecentWikiPages(value: unknown): RecentWikiPage[] {
  if (!Array.isArray(value)) return [];
  const entries: RecentWikiPage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, openedAt, path } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof path !== "string"
    )
      continue;
    const entry = {
      id,
      name,
      openedAt: typeof openedAt === "string" ? openedAt : "",
      path,
    };
    if (!usable(entry)) continue;
    entries.push(entry);
    if (entries.length === RECENT_LIMIT) break;
  }
  return entries;
}

function usable(entry: RecentWikiPage) {
  return (
    entry.id.trim() !== "" &&
    entry.name.trim() !== "" &&
    entry.path.trim() !== ""
  );
}

function storageKey(accountId: string) {
  return `${STORAGE_PREFIX}${accountId}`;
}
