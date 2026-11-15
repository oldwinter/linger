import {
  notifyPreferenceChange,
  removePreferenceKeys,
  storedPreferenceKeys,
  subscribePreferenceChange,
} from "@/lib/local-preference-keys";

const RECENT_LIMIT = 5;
const STORAGE_PREFIX = "library-recent-documents.v1:";
const RECENT_DOCUMENTS_CHANGED = "library-recent-documents-changed";

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
 * Reads the stored list for one Account in one Tenant. Unreadable JSON and
 * entries that lost their id or name are dropped, so damaged storage cannot
 * break the Library.
 */
export function readRecentDocuments(
  accountId: string | undefined,
  tenantId: string | undefined,
): RecentDocument[] {
  if (!accountId || !tenantId) return [];
  try {
    const stored = window.localStorage.getItem(storageKey(accountId, tenantId));
    return parseRecentDocuments(stored === null ? [] : JSON.parse(stored));
  } catch {
    return [];
  }
}

export function writeRecentDocuments(
  accountId: string | undefined,
  tenantId: string | undefined,
  entries: readonly RecentDocument[],
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
  notifyPreferenceChange(RECENT_DOCUMENTS_CHANGED);
}

export function clearRecentDocuments(
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
  notifyPreferenceChange(RECENT_DOCUMENTS_CHANGED);
}

/** Whether this browser lists a recently opened Document for any Account. */
export function hasRecentDocuments(): boolean {
  return storedPreferenceKeys([STORAGE_PREFIX]).length > 0;
}

/** Clears the list for every Account in this browser. */
export function clearAllRecentDocuments(): void {
  removePreferenceKeys([STORAGE_PREFIX]);
  notifyPreferenceChange(RECENT_DOCUMENTS_CHANGED);
}

export function subscribeRecentDocuments(listener: () => void): () => void {
  return subscribePreferenceChange(RECENT_DOCUMENTS_CHANGED, listener);
}

/** Records one open for the Account and Tenant that opened it. */
export function recordRecentDocument(
  accountId: string | undefined,
  tenantId: string | undefined,
  entry: RecentDocument,
): void {
  if (!accountId || !tenantId) return;
  writeRecentDocuments(
    accountId,
    tenantId,
    addRecentDocument(readRecentDocuments(accountId, tenantId), entry),
  );
}

/**
 * Forgets one Document for the Account and Tenant, keeping the rest in order.
 * A missing or unreadable list simply has nothing to forget, so it is left
 * alone.
 */
export function removeRecentDocument(
  accountId: string | undefined,
  tenantId: string | undefined,
  documentId: string,
): void {
  if (!accountId || !tenantId) return;
  const entries = readRecentDocuments(accountId, tenantId);
  if (!entries.some((entry) => entry.id === documentId)) return;
  const remaining = entries.filter((entry) => entry.id !== documentId);
  if (remaining.length === 0) {
    clearRecentDocuments(accountId, tenantId);
    return;
  }
  writeRecentDocuments(accountId, tenantId, remaining);
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

function storageKey(accountId: string, tenantId: string) {
  return `${STORAGE_PREFIX}${accountId}.${tenantId}`;
}
