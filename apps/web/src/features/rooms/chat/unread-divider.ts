import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

export type UnreadDividerPlacement =
  | { kind: "none" }
  /** Every loaded Message is unread, so the boundary is older than the page. */
  | { kind: "beyond-page" }
  | { index: number; kind: "visible" };

/**
 * Places the "New messages" divider in the Messages the timeline renders: the
 * first Message after the Room's read boundary. A Message without `room_seq`
 * comes from a server that predates the field, so it cannot establish a
 * boundary.
 */
export function findUnreadDividerIndex(
  messages: readonly TeamHubMessage[],
  readThroughRoomSeq: number,
): UnreadDividerPlacement {
  const firstUnread = messages.findIndex(
    (message) =>
      message.room_seq !== undefined && message.room_seq > readThroughRoomSeq,
  );
  if (firstUnread < 0) return { kind: "none" };
  if (firstUnread === 0) return { kind: "beyond-page" };
  return { index: firstUnread, kind: "visible" };
}
