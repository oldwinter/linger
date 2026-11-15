import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import {
  notifyPreferenceChange,
  removePreferenceKeys,
  storedPreferenceKeys,
  subscribePreferenceChange,
} from "@/lib/local-preference-keys";

const PREFERENCE_PREFIX = "room-unread-filter.v1:";
const FILTER_CHANGED = "room-unread-filter-changed";

/** Which Rooms the list shows: everything, the unread ones, or the mentions. */
export type RoomFilterMode = "all" | "unread" | "mentions";

/**
 * The Room rows the list shows for one mode. The active Room always stays, so
 * switching Rooms never hides the one the person is in.
 */
export function roomFilterRows(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId: string | undefined,
  mode: RoomFilterMode,
): TeamHubRoomListItem[] {
  if (mode === "unread") return unreadRoomRows(rooms, activeRoomId, true);
  if (mode === "mentions") return mentionRoomRows(rooms, activeRoomId);
  return [...rooms];
}

/** Keeps Rooms with unread Messages or unread mentions. */
export function unreadRoomRows(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId: string | undefined,
  unreadOnly: boolean,
): TeamHubRoomListItem[] {
  if (!unreadOnly) return [...rooms];
  return rooms.filter(
    (room) =>
      room.id === activeRoomId ||
      room.unread_message_count > 0 ||
      room.unread_mention_count > 0,
  );
}

/** Keeps Rooms with unread mentions, so addressed Messages stay findable. */
export function mentionRoomRows(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId: string | undefined,
): TeamHubRoomListItem[] {
  return rooms.filter(
    (room) => room.id === activeRoomId || room.unread_mention_count > 0,
  );
}

/**
 * Reads the Account's choice. The old boolean value still means what it did:
 * true was unread-only and false was every Room. Anything unreadable starts at
 * every Room rather than breaking the Room list.
 */
export function readRoomFilterMode(
  accountId: string | undefined,
): RoomFilterMode {
  if (!accountId) return "all";
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(preferenceKey(accountId)) ?? "null",
    );
    if (value === true) return "unread";
    if (value === "unread" || value === "mentions") return value;
    return "all";
  } catch {
    return "all";
  }
}

export function writeRoomFilterMode(
  accountId: string | undefined,
  mode: RoomFilterMode,
): void {
  if (!accountId) return;
  try {
    if (mode === "all") {
      window.localStorage.removeItem(preferenceKey(accountId));
    } else {
      window.localStorage.setItem(
        preferenceKey(accountId),
        JSON.stringify(mode),
      );
    }
  } catch {
    // Blocked storage keeps the choice for this tab only.
    return;
  }
  notifyPreferenceChange(FILTER_CHANGED);
}

/** Whether this browser stores the filter for any Account. */
export function hasRoomUnreadFilter(): boolean {
  return storedPreferenceKeys([PREFERENCE_PREFIX]).length > 0;
}

/** Turns the filter off for every Account in this browser. */
export function clearRoomUnreadFilter(): void {
  removePreferenceKeys([PREFERENCE_PREFIX]);
  notifyPreferenceChange(FILTER_CHANGED);
}

/** A filter write or clear in this tab or another one re-reads the choice. */
export function subscribeRoomUnreadFilter(listener: () => void): () => void {
  return subscribePreferenceChange(FILTER_CHANGED, listener);
}

function preferenceKey(accountId: string) {
  return `${PREFERENCE_PREFIX}${accountId}`;
}
