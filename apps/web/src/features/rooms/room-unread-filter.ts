import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import {
  removePreferenceKeys,
  storedPreferenceKeys,
} from "@/lib/local-preference-keys";

const PREFERENCE_PREFIX = "room-unread-filter.v1:";
const FILTER_CHANGED = "room-unread-filter-changed";

/**
 * The Room rows the list shows. With the filter on, a Room stays when it has
 * unread Messages or unread mentions; the active Room always stays, so
 * switching Rooms never hides the one the person is in.
 */
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

/**
 * The choice belongs to one Account, so signing in elsewhere starts with the
 * filter off. A stored value that is not readable JSON falls back to off rather
 * than breaking the Room list.
 */
export function readRoomUnreadFilter(accountId: string | undefined): boolean {
  if (!accountId) return false;
  try {
    const stored = window.localStorage.getItem(preferenceKey(accountId));
    return JSON.parse(stored ?? "false") === true;
  } catch {
    return false;
  }
}

export function writeRoomUnreadFilter(
  accountId: string | undefined,
  unreadOnly: boolean,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(
      preferenceKey(accountId),
      JSON.stringify(unreadOnly),
    );
  } catch {
    // Blocked storage keeps the choice for this tab only.
    return;
  }
  window.dispatchEvent(new Event(FILTER_CHANGED));
}

/** Whether this browser stores the filter for any Account. */
export function hasRoomUnreadFilter(): boolean {
  return storedPreferenceKeys([PREFERENCE_PREFIX]).length > 0;
}

/** Turns the filter off for every Account in this browser. */
export function clearRoomUnreadFilter(): void {
  removePreferenceKeys([PREFERENCE_PREFIX]);
  window.dispatchEvent(new Event(FILTER_CHANGED));
}

/** A filter write or clear in this tab or another one re-reads the choice. */
export function subscribeRoomUnreadFilter(listener: () => void): () => void {
  window.addEventListener(FILTER_CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(FILTER_CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

function preferenceKey(accountId: string) {
  return `${PREFERENCE_PREFIX}${accountId}`;
}
