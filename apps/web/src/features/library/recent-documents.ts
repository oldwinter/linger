import {
  removePreferenceKeys,
  storedPreferenceKeys,
} from "@/lib/local-preference-keys";

const RECENT_LIMIT = 5;
const STORAGE_PREFIX = "library-recent-documents.v1:";

/** One Document the person opened, as it was named and formatted then. */
export interface RecentDocument {
  id: string;
  name: string;
  formatLabel: string;
  openedAt: string;
}

/**
 * The front of the list is the newest open, so reopening a Document moves it
 * there instead of adding a second entry. An entry without an id or name could
 * not be shown or linked, so it never enters the list.
 */
export function addRecentDocument(
  entries: readonly RecentDocument[],
  entry: RecentDocument,
): RecentDocument[] {
  if (!usable(entry)) return entries.filter(usable);
  return [
    entry,
    ...entries.filter((other) => usable(other) && other.id !== entry.id),
  ].slice(0, RECENT_LIMIT);
}

/**
 * Reads the stored list for one Account. Unreadable JSON and entries that lost
 * their id or name are dropped, so damaged storage cannot break the Library.
 */
export function readRecentDocuments(
  accountId: string | undefined,
): RecentDocument[] {
  if (!accountId) return [];
  try {
    const stored = window.localStorage.getItem(storageKey(accountId));
    return parseRecentDocuments(stored === null ? [] : JSON.parse(stored));
  } catch {
    return [];
  }
}

export function writeRecentDocuments(
  accountId: string | undefined,
  entries: readonly RecentDocument[],
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

export function clearRecentDocuments(accountId: string | undefined): void {
  if (!accountId) return;
  try {
    window.localStorage.removeItem(storageKey(accountId));
  } catch {
    // Blocked storage has nothing to clear.
  }
}

/** Whether this browser lists a recently opened Document for any Account. */
export function hasRecentDocuments(): boolean {
  return storedPreferenceKeys([STORAGE_PREFIX]).length > 0;
}

/** Clears the list for every Account in this browser. */
export function clearAllRecentDocuments(): void {
  removePreferenceKeys([STORAGE_PREFIX]);
}

/** Records one open for the Account that opened it. */
export function recordRecentDocument(
  accountId: string | undefined,
  entry: RecentDocument,
): void {
  if (!accountId) return;
  writeRecentDocuments(
    accountId,
    addRecentDocument(readRecentDocuments(accountId), entry),
  );
}

/**
 * Forgets one Document for the Account, keeping the rest in order. A missing or
 * unreadable list simply has nothing to forget, so it is left alone.
 */
export function removeRecentDocument(
  accountId: string | undefined,
  documentId: string,
): void {
  if (!accountId) return;
  const entries = readRecentDocuments(accountId);
  if (!entries.some((entry) => entry.id === documentId)) return;
  const remaining = entries.filter((entry) => entry.id !== documentId);
  if (remaining.length === 0) {
    clearRecentDocuments(accountId);
    return;
  }
  writeRecentDocuments(accountId, remaining);
}

function parseRecentDocuments(value: unknown): RecentDocument[] {
  if (!Array.isArray(value)) return [];
  const entries: RecentDocument[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { formatLabel, id, name, openedAt } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string") continue;
    const entry = {
      formatLabel: typeof formatLabel === "string" ? formatLabel : "",
      id,
      name,
      openedAt: typeof openedAt === "string" ? openedAt : "",
    };
    if (!usable(entry)) continue;
    entries.push(entry);
    if (entries.length === RECENT_LIMIT) break;
  }
  return entries;
}

function usable(entry: RecentDocument) {
  return entry.id.trim() !== "" && entry.name.trim() !== "";
}

function storageKey(accountId: string) {
  return `${STORAGE_PREFIX}${accountId}`;
}
