import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

/** One Room the recap names, with the latest message and its unread count. */
export interface AwayRecapRow {
  id: string;
  name: string;
  snippet: string;
  unreadCount: number;
}

/** What waited in the Room list while the Human was elsewhere. */
export interface AwayRecap {
  messageCount: number;
  mentionCount: number;
  roomCount: number;
  /**
   * The newest activity the recap covers. A dismissal hides everything up to
   * it, so a later message brings the card back.
   */
  newestAt: string | null;
  rows: AwayRecapRow[];
}

const ROW_LIMIT = 3;
const DISMISSAL_PREFIX = "away-recap-dismissed.v1:";

/**
 * Summarizes the Rooms with unread Messages. A Thread is a reply inside a
 * conversation the parent Room already counts, and the open Room is on screen,
 * so neither belongs in the recap.
 */
export function awayRecap(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId?: string,
): AwayRecap {
  const unread = rooms.filter(
    (room) =>
      room.unread_message_count > 0 &&
      room.kind !== "thread" &&
      room.id !== activeRoomId,
  );
  const recap: AwayRecap = {
    messageCount: 0,
    mentionCount: 0,
    roomCount: unread.length,
    newestAt: null,
    rows: [],
  };
  let newest = Number.NEGATIVE_INFINITY;
  for (const room of unread) {
    recap.messageCount += room.unread_message_count;
    recap.mentionCount += room.unread_mention_count;
    const at = activityTime(room);
    if (at > newest) {
      newest = at;
      recap.newestAt = activityTimestamp(room);
    }
  }
  const recent = [...unread].sort(
    (left, right) => activityTime(right) - activityTime(left),
  );
  recap.rows = recent.slice(0, ROW_LIMIT).map((room) => ({
    id: room.id,
    name: roomName(room),
    snippet: roomSnippet(room),
    unreadCount: room.unread_message_count,
  }));
  return recap;
}

/**
 * A dismissal hides the Rooms it covered; a Room whose latest message is newer
 * brings the card back. A stored value that is not a timestamp never hides
 * anything, so damaged storage cannot silence the recap.
 */
export function awayRecapVisible(
  recap: AwayRecap,
  dismissedAt: string | null,
): boolean {
  if (recap.roomCount === 0) return false;
  if (dismissedAt === null) return true;
  const dismissed = Date.parse(dismissedAt);
  if (!Number.isFinite(dismissed)) return true;
  return recap.newestAt !== null && Date.parse(recap.newestAt) > dismissed;
}

/**
 * A dismissal belongs to one Account in one Tenant, so signing in elsewhere or
 * switching spaces shows that space's recap as it was left.
 */
export function readAwayRecapDismissal(
  accountId: string | undefined,
  tenantId: string,
): string | null {
  if (!accountId) return null;
  try {
    return window.localStorage.getItem(dismissalKey(accountId, tenantId));
  } catch {
    return null;
  }
}

export function writeAwayRecapDismissal(
  accountId: string | undefined,
  tenantId: string,
  cutoff: string | null,
): void {
  if (!accountId || cutoff === null) return;
  try {
    window.localStorage.setItem(dismissalKey(accountId, tenantId), cutoff);
  } catch {
    // Blocked storage keeps the dismissal for this tab only.
  }
}

function dismissalKey(accountId: string, tenantId: string) {
  return `${DISMISSAL_PREFIX}${accountId}:${tenantId}`;
}

/** The Room list sorts by this too; a Room without a Message falls back to its creation. */
function activityTimestamp(room: TeamHubRoomListItem) {
  return room.latest_message?.created_at ?? room.created_at;
}

function activityTime(room: TeamHubRoomListItem) {
  return Date.parse(activityTimestamp(room));
}

function roomName(room: TeamHubRoomListItem) {
  return room.kind === "direct"
    ? (room.direct_peer?.display_name ?? room.name)
    : room.name;
}

function roomSnippet(room: TeamHubRoomListItem) {
  const latest = room.latest_message
    ? markdownPlainText(room.latest_message.raw_message)
    : "";
  return latest || room.description || "No messages yet";
}
