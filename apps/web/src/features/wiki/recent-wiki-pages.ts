import {
  notifyPreferenceChange,
  storedPreferenceKeys,
  subscribePreferenceChange,
} from "@/lib/local-preference-keys";

import {
  RECENT_WIKI_PAGES_CHANGED,
  RECENT_WIKI_PAGES_PREFIX as STORAGE_PREFIX,
  clearAllRecentWikiPages,
} from "./recent-wiki-pages-storage";

const RECENT_LIMIT = 5;

export { clearAllRecentWikiPages };

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
 * Reads the stored list for one Account in one Tenant. Unreadable JSON and
 * entries that lost their identity or route are dropped, so damaged storage
 * cannot break the Wiki home.
 */
export function readRecentWikiPages(
  accountId: string | undefined,
  tenantId: string | undefined,
): RecentWikiPage[] {
  if (!accountId || !tenantId) return [];
  try {
    const stored = window.localStorage.getItem(storageKey(accountId, tenantId));
    return parseRecentWikiPages(stored === null ? [] : JSON.parse(stored));
  } catch {
    return [];
  }
}

export function writeRecentWikiPages(
  accountId: string | undefined,
  tenantId: string | undefined,
  entries: readonly RecentWikiPage[],
): void {
  if (!accountId || !tenantId) return;
  const trimmed = entries.filter(usable).slice(0, RECENT_LIMIT);
  try {
    if (trimmed.length === 0) {
      window.localStorage.removeItem(storageKey(accountId, tenantId));
    } else {
      window.localStorage.setItem(
        storageKey(accountId, tenantId),
        JSON.stringify(trimmed),
      );
    }
  } catch {
    // Blocked storage keeps the list for this tab only.
    return;
  }
  notifyPreferenceChange(RECENT_WIKI_PAGES_CHANGED);
}

/**
 * Forgets one page by the identity the store keys on. The rest keep their
 * order, the key goes when the last entry does, and a list without that page
 * is left as it is, damaged storage included.
 */
export function removeRecentWikiPage(
  accountId: string | undefined,
  tenantId: string | undefined,
  pageId: string,
): void {
  if (!accountId || !tenantId) return;
  const entries = readRecentWikiPages(accountId, tenantId);
  if (!entries.some((entry) => entry.id === pageId)) return;
  const remaining = entries.filter((entry) => entry.id !== pageId);
  if (remaining.length === 0) {
    clearRecentWikiPages(accountId, tenantId);
    return;
  }
  writeRecentWikiPages(accountId, tenantId, remaining);
}

export function clearRecentWikiPages(
  accountId: string | undefined,
  tenantId: string | undefined,
): void {
  if (!accountId || !tenantId) return;
  try {
    window.localStorage.removeItem(storageKey(accountId, tenantId));
  } catch {
    // Blocked storage has nothing to clear.
    return;
  }
  notifyPreferenceChange(RECENT_WIKI_PAGES_CHANGED);
}

/** Whether this browser lists a recently opened Wiki page for any Account. */
export function hasRecentWikiPages(): boolean {
  return storedPreferenceKeys([STORAGE_PREFIX]).length > 0;
}

export function subscribeRecentWikiPages(listener: () => void): () => void {
  return subscribePreferenceChange(RECENT_WIKI_PAGES_CHANGED, listener);
}

/** Records one open for the Account and Tenant that opened it. */
export function recordRecentWikiPage(
  accountId: string | undefined,
  tenantId: string | undefined,
  entry: RecentWikiPage,
): void {
  if (!accountId || !tenantId) return;
  writeRecentWikiPages(
    accountId,
    tenantId,
    addRecentWikiPage(readRecentWikiPages(accountId, tenantId), entry),
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

function storageKey(accountId: string, tenantId: string) {
  return `${STORAGE_PREFIX}${accountId}.${tenantId}`;
}
