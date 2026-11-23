import type {
  TeamHubMessageDocumentReference,
  TeamHubMessageSkillReference,
} from "@/features/teamhub/teamhub-message-content";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { isRecord } from "@linger/service-kit";

const roomComposerDraftPrefix = "linger.room-composer-draft:";
const composerDraftFormat = "linger-composer-draft-v3";
const roomComposerHistoryPrefix = "linger.room-composer-history:";
const composerHistoryFormat = "linger-composer-history-v1";
const composerHistoryLimit = 50;
// Pasted logs and documents stay out of history, so a scope holds at most
// about 100K characters and history cannot crowd drafts out of storage.
const composerHistoryEntryMaxLength = 2_000;

export interface RoomDraftScope {
  accountId: string;
  roomId: string;
  tenantId: string;
  threadId?: string;
}

export interface RoomComposerDraft {
  voiceMaterials?: VoiceDocumentSelection[];
  documentContexts: RoomComposerDocumentContext[];
  body: string;
  documentReferences: RoomComposerDocumentReference[];
  mentions: TeamHubActorRef[];
  skillReferences: TeamHubMessageSkillReference[];
}

/** A sent message the composer can bring back: its text and the references
 * it carried, without attachments, voice materials or Document contexts. */
export interface RoomComposerHistoryEntry {
  body: string;
  documentReferences: RoomComposerDocumentReference[];
  mentions: TeamHubActorRef[];
  skillReferences: TeamHubMessageSkillReference[];
}

/** An explicitly selected excerpt, not a verified Document anchor or read pin.
 * It comes from exactly one source: a Document (`documentId`) or a Message in
 * the same Room (`messageId`, with the author's name as `title`). A Document
 * material with an empty `quote` stands for the whole file. */
export interface VoiceDocumentSelection {
  id: string;
  documentId?: string;
  messageId?: string;
  title: string;
  quote: string;
  versionId?: string;
}

export interface RoomComposerDocumentContext {
  documentId: string;
  documentVersionId: string;
  filename: string;
  sourceRoomId: string;
  sourceRoomName: string;
  versionNumber: number;
}

export type RoomComposerDocumentReference =
  TeamHubMessageDocumentReference & {};

const draftListeners = new Set<() => void>();

/** Calls `listener` after any Room composer draft in this tab changes. */
export function subscribeRoomComposerDrafts(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function notifyDraftListeners() {
  for (const listener of draftListeners) listener();
}

export function readRoomComposerDraft(
  scope: RoomDraftScope,
): RoomComposerDraft {
  try {
    const stored = resolveLocalStorage()?.getItem(roomComposerDraftKey(scope));
    return stored ? parseComposerDraft(stored) : emptyComposerDraft();
  } catch {
    return emptyComposerDraft();
  }
}

export function writeRoomComposerDraft(
  scope: RoomDraftScope,
  draft: RoomComposerDraft,
) {
  try {
    const storage = resolveLocalStorage();
    if (
      !draft.body &&
      draft.documentContexts.length === 0 &&
      !draft.voiceMaterials?.length
    ) {
      storage?.removeItem(roomComposerDraftKey(scope));
    } else {
      storage?.setItem(
        roomComposerDraftKey(scope),
        JSON.stringify({ ...draft, format: composerDraftFormat }),
      );
    }
  } catch {
    // The composer remains usable in memory when browser storage is unavailable.
  }
  notifyDraftListeners();
}

export function clearRoomDrafts() {
  try {
    const storage = resolveLocalStorage();

    if (!storage) {
      return;
    }

    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);

      if (
        key?.startsWith(roomComposerDraftPrefix) ||
        key?.startsWith(roomComposerHistoryPrefix)
      ) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  notifyDraftListeners();
}

/** Whether this browser holds a Room composer draft for any Account. */
export function hasRoomDrafts(): boolean {
  return draftStorageEntries().length > 0;
}

/** One snapshot of this tab's saved composer drafts, one entry per storage
 * key. Reading storage can fail in privacy-restricted contexts. */
export function draftStorageEntries(): [string, string][] {
  try {
    const storage = resolveLocalStorage();
    if (!storage) return [];
    const entries: [string, string][] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(roomComposerDraftPrefix)) continue;
      const value = storage.getItem(key);
      if (value !== null) entries.push([key, value]);
    }
    return entries;
  } catch {
    return [];
  }
}

/** Sent messages in this scope, oldest first. */
export function readRoomComposerHistory(
  scope: RoomDraftScope,
): RoomComposerHistoryEntry[] {
  try {
    const stored = resolveLocalStorage()?.getItem(
      roomScopeKey(roomComposerHistoryPrefix, scope),
    );
    if (!stored) return [];
    const candidate: unknown = JSON.parse(stored);
    if (!isRecord(candidate) || candidate.format !== composerHistoryFormat) {
      return [];
    }
    return Array.isArray(candidate.entries)
      ? candidate.entries.flatMap((entry: unknown) => {
          if (!isRecord(entry) || typeof entry.body !== "string") return [];
          return [
            {
              body: entry.body,
              documentReferences: Array.isArray(entry.documentReferences)
                ? entry.documentReferences.filter(isDocumentReference)
                : [],
              mentions: Array.isArray(entry.mentions)
                ? entry.mentions.filter(isActorReference)
                : [],
              skillReferences: Array.isArray(entry.skillReferences)
                ? entry.skillReferences.filter(isSkillReference)
                : [],
            },
          ];
        })
      : [];
  } catch {
    return [];
  }
}

/**
 * The Rooms whose own composer or a thread composer holds text, from one
 * snapshot of draft storage. Another Account's or Tenant's drafts are outside
 * this list, whitespace alone is not text, and a key or value this code cannot
 * read simply names no Room.
 */
export function roomsWithDrafts(
  entries: Iterable<readonly [string, string]>,
  accountId: string | undefined,
  tenantId: string,
): Set<string> {
  const roomIds = new Set<string>();
  if (!accountId) return roomIds;
  const account = encodeURIComponent(accountId);
  const tenant = encodeURIComponent(tenantId);
  for (const [key, value] of entries) {
    try {
      if (!key.startsWith(roomComposerDraftPrefix)) continue;
      const [storedAccount, storedTenant, storedRoom] = key
        .slice(roomComposerDraftPrefix.length)
        .split(":");
      if (storedAccount !== account || storedTenant !== tenant || !storedRoom)
        continue;
      if (parseComposerDraft(value).body.trim())
        roomIds.add(decodeURIComponent(storedRoom));
    } catch {
      // A malformed key or value names no readable draft.
    }
  }
  return roomIds;
}

/**
 * Records a sent message. Repeating the latest one, or a message longer than
 * history keeps, adds nothing.
 */
export function appendRoomComposerHistory(
  scope: RoomDraftScope,
  entry: RoomComposerHistoryEntry,
) {
  if (!entry.body.trim() || entry.body.length > composerHistoryEntryMaxLength) {
    return;
  }
  const entries = readRoomComposerHistory(scope);
  if (entries.at(-1)?.body === entry.body) return;
  let kept = [...entries, entry].slice(-composerHistoryLimit);
  while (kept.length) {
    try {
      resolveLocalStorage()?.setItem(
        roomScopeKey(roomComposerHistoryPrefix, scope),
        JSON.stringify({ entries: kept, format: composerHistoryFormat }),
      );
      return;
    } catch {
      // A full storage quota drops the older half rather than the new
      // message; without browser storage the composer has no history.
      kept = kept.slice(Math.ceil(kept.length / 2));
    }
  }
}

function roomComposerDraftKey(scope: RoomDraftScope) {
  return roomScopeKey(roomComposerDraftPrefix, scope);
}

function roomScopeKey(prefix: string, scope: RoomDraftScope) {
  const segments = [scope.accountId, scope.tenantId, scope.roomId];

  if (scope.threadId) {
    segments.push(scope.threadId);
  }

  return `${prefix}${segments.map(encodeURIComponent).join(":")}`;
}

function resolveLocalStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function parseComposerDraft(stored: string): RoomComposerDraft {
  try {
    const candidate: unknown = JSON.parse(stored);
    if (!isRecord(candidate) || candidate.format !== composerDraftFormat) {
      return emptyComposerDraft();
    }
    return {
      ...(Array.isArray(candidate.voiceMaterials)
        ? {
            voiceMaterials: candidate.voiceMaterials
              .filter(isVoiceDocumentSelection)
              .slice(0, 5),
          }
        : {}),
      documentContexts: Array.isArray(candidate.documentContexts)
        ? candidate.documentContexts.filter(isDocumentContext)
        : [],
      body: typeof candidate.body === "string" ? candidate.body : "",
      documentReferences: Array.isArray(candidate.documentReferences)
        ? candidate.documentReferences.filter(isDocumentReference)
        : [],
      mentions: Array.isArray(candidate.mentions)
        ? candidate.mentions.filter(isActorReference)
        : [],
      skillReferences: Array.isArray(candidate.skillReferences)
        ? candidate.skillReferences.filter(isSkillReference)
        : [],
    };
  } catch {
    return emptyComposerDraft();
  }
}

export function isVoiceDocumentSelection(
  value: unknown,
): value is VoiceDocumentSelection {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    (typeof value.documentId === "string"
      ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.documentId) &&
        value.messageId === undefined
      : value.documentId === undefined &&
        typeof value.messageId === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.messageId) &&
        value.versionId === undefined) &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    value.title.length <= 512 &&
    typeof value.quote === "string" &&
    (value.quote.trim().length > 0 || typeof value.documentId === "string") &&
    value.quote.length <= 10_000 &&
    (value.versionId === undefined ||
      (typeof value.versionId === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.versionId)))
  );
}

function emptyComposerDraft(): RoomComposerDraft {
  return {
    documentContexts: [],
    body: "",
    documentReferences: [],
    mentions: [],
    skillReferences: [],
  };
}

function isDocumentContext(
  value: unknown,
): value is RoomComposerDocumentContext {
  return (
    isRecord(value) &&
    typeof value.documentId === "string" &&
    typeof value.documentVersionId === "string" &&
    typeof value.filename === "string" &&
    typeof value.sourceRoomId === "string" &&
    typeof value.sourceRoomName === "string" &&
    Number.isSafeInteger(value.versionNumber) &&
    (value.versionNumber as number) > 0
  );
}

function isActorReference(value: unknown): value is TeamHubActorRef {
  return (
    isRecord(value) &&
    typeof value.display_name === "string" &&
    typeof value.id === "string" &&
    (value.kind === "agent" || value.kind === "human") &&
    typeof value.tenant_id === "string"
  );
}

function isDocumentReference(
  value: unknown,
): value is RoomComposerDocumentReference {
  return (
    isRecord(value) &&
    typeof value.documentId === "string" &&
    typeof value.token === "string"
  );
}

function isSkillReference(
  value: unknown,
): value is TeamHubMessageSkillReference {
  return (
    isRecord(value) &&
    typeof value.manifestVersion === "string" &&
    typeof value.skillId === "string" &&
    typeof value.target === "string" &&
    typeof value.token === "string"
  );
}
