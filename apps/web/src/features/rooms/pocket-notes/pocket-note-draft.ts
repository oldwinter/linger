import { isRecord } from "@linger/service-kit";

import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import {
  broadcastPocketNoteChannelUpdate,
  POCKET_NOTE_SYNC_CHANNEL,
  pocketNoteExpectedUpdatedAt,
  pocketNoteTabSenderId,
  resolvePocketNoteBroadcastChannel,
} from "./pocket-note-queries";

const pocketNoteDraftPrefix = "linger.pocket-note-draft:v1:";
const pocketNoteDraftFormat = "linger-pocket-note-draft-v1";
const pocketNoteSyncPrefix = "linger.pocket-note-sync:v1:";

export { pocketNoteExpectedUpdatedAt };

export interface PocketNoteDraftScope {
  accountId: string;
  date: string;
  tenantId: string;
}

export interface PocketNoteLocalDraft {
  /** Server note text this local draft branched from. */
  baseText: string;
  /** Server updated_at token this local draft branched from ("" if empty). */
  baseUpdatedAt: string;
  /** Unsaved local draft text. */
  text: string;
  /** Client ISO timestamp when this local draft was last updated. */
  updatedAt: string;
}

interface PocketNoteBroadcastMessage {
  accountId: string;
  note: TeamHubPocketNote;
  senderId: string;
  tenantId: string;
}

/** Calendar day (`YYYY-MM-DD`) in the browser's local time zone. */
export function localPocketNoteDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function pocketNoteDraftKey(scope: PocketNoteDraftScope): string {
  return scopeKey(pocketNoteDraftPrefix, scope);
}

/**
 * Reads a durable local draft scoped strictly to `(accountId, tenantId, date)`.
 * Returns `undefined` when absent, malformed, or browser storage is blocked.
 */
export function readPocketNoteDraft(
  scope: PocketNoteDraftScope,
): PocketNoteLocalDraft | undefined {
  if (!hasCompleteScope(scope)) return undefined;
  try {
    const raw = resolveLocalStorage()?.getItem(pocketNoteDraftKey(scope));
    return raw ? parsePocketNoteDraft(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persists an unsaved Pocket Note draft for `(accountId, tenantId, date)`.
 * On quota errors, prunes strictly older dates for the same account+tenant and
 * retries once; returns `false` without throwing when storage stays unavailable.
 */
export function writePocketNoteDraft(
  scope: PocketNoteDraftScope,
  draft: PocketNoteLocalDraft,
): boolean {
  if (!hasCompleteScope(scope)) return false;
  const key = pocketNoteDraftKey(scope);
  const payload = JSON.stringify({
    ...draft,
    format: pocketNoteDraftFormat,
  });
  try {
    const storage = resolveLocalStorage();
    if (!storage) return false;
    storage.setItem(key, payload);
    return true;
  } catch {
    if (!pruneOlderPocketNoteDrafts(scope)) return false;
    try {
      const storage = resolveLocalStorage();
      if (!storage) return false;
      storage.setItem(key, payload);
      return true;
    } catch {
      return false;
    }
  }
}

/** Removes the local recovery entry for `(accountId, tenantId, date)`. */
export function clearPocketNoteDraft(scope: PocketNoteDraftScope): void {
  if (!hasCompleteScope(scope)) return;
  try {
    resolveLocalStorage()?.removeItem(pocketNoteDraftKey(scope));
  } catch {
    // Storage can be blocked in privacy-restricted browser contexts.
  }
}

/**
 * Notifies other open tabs of the same account and tenant that today's Pocket
 * Note changed on the server. Uses BroadcastChannel in memory and triggers a
 * metadata-only storage event (no note text left in localStorage) as fallback.
 */
export function broadcastPocketNoteUpdated(input: {
  accountId?: string;
  note: TeamHubPocketNote;
  tenantId: string;
}): void {
  const { accountId, note, tenantId } = input;
  if (!accountId || !tenantId || !note.date) return;
  broadcastPocketNoteChannelUpdate(input);
  try {
    const storage = resolveLocalStorage();
    if (!storage) return;
    const key = scopeKey(pocketNoteSyncPrefix, {
      accountId,
      date: note.date,
      tenantId,
    });
    const signal = JSON.stringify({
      date: note.date,
      nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      updatedAt: pocketNoteExpectedUpdatedAt(note) ?? "",
    });
    storage.setItem(key, signal);
    storage.removeItem(key);
  } catch {
    // Ignore blocked or full storage; optimistic concurrency still guards writes.
  }
}

/**
 * Subscribes to cross-tab server updates for one `(accountId, tenantId, date)`.
 * Same-tab broadcasts are ignored; another account or tenant never matches.
 */
export function subscribePocketNoteUpdates(
  scope: PocketNoteDraftScope,
  handlers: {
    onNote: (note: TeamHubPocketNote) => void;
    onRemoteChange: () => void;
  },
): () => void {
  if (!hasCompleteScope(scope) || typeof window === "undefined") {
    return () => undefined;
  }
  let channel: BroadcastChannel | undefined;
  const Channel = resolvePocketNoteBroadcastChannel();
  if (Channel) {
    try {
      channel = new Channel(POCKET_NOTE_SYNC_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        const payload = parseBroadcastMessage(event.data);
        if (
          !payload ||
          payload.senderId === pocketNoteTabSenderId ||
          payload.accountId !== scope.accountId ||
          payload.tenantId !== scope.tenantId ||
          payload.note.date !== scope.date
        ) {
          return;
        }
        handlers.onNote(payload.note);
      });
    } catch {
      channel = undefined;
    }
  }
  const syncStorageKey = scopeKey(pocketNoteSyncPrefix, scope);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== syncStorageKey || event.newValue === null) return;
    handlers.onRemoteChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    try {
      channel?.close();
    } catch {
      // Ignore already-closed channel errors.
    }
  };
}

function hasCompleteScope(scope: PocketNoteDraftScope): boolean {
  return Boolean(scope.accountId && scope.tenantId && scope.date);
}

function scopeKey(prefix: string, scope: PocketNoteDraftScope): string {
  return `${prefix}${[scope.accountId, scope.tenantId, scope.date]
    .map(encodeURIComponent)
    .join(":")}`;
}

function resolveLocalStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function pruneOlderPocketNoteDrafts(scope: PocketNoteDraftScope): boolean {
  try {
    const storage = resolveLocalStorage();
    if (!storage) return false;
    const ownerPrefix = `${pocketNoteDraftPrefix}${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.tenantId)}:`;
    let removed = false;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(ownerPrefix)) continue;
      const storedDate = decodeURIComponent(key.slice(ownerPrefix.length));
      if (storedDate < scope.date) {
        storage.removeItem(key);
        removed = true;
      }
    }
    return removed;
  } catch {
    return false;
  }
}

function parsePocketNoteDraft(raw: string): PocketNoteLocalDraft | undefined {
  try {
    const candidate: unknown = JSON.parse(raw);
    if (
      !isRecord(candidate) ||
      candidate.format !== pocketNoteDraftFormat ||
      typeof candidate.text !== "string" ||
      typeof candidate.baseText !== "string" ||
      typeof candidate.baseUpdatedAt !== "string" ||
      typeof candidate.updatedAt !== "string"
    ) {
      return undefined;
    }
    return {
      baseText: candidate.baseText,
      baseUpdatedAt: candidate.baseUpdatedAt,
      text: candidate.text,
      updatedAt: candidate.updatedAt,
    };
  } catch {
    return undefined;
  }
}

function parseBroadcastMessage(
  value: unknown,
): PocketNoteBroadcastMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.accountId !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.senderId !== "string" ||
    !isRecord(value.note) ||
    typeof value.note.date !== "string" ||
    typeof value.note.text !== "string" ||
    typeof value.note.updated_at !== "string"
  ) {
    return undefined;
  }
  return {
    accountId: value.accountId,
    note: {
      date: value.note.date,
      text: value.note.text,
      updated_at: value.note.updated_at,
    },
    senderId: value.senderId,
    tenantId: value.tenantId,
  };
}
