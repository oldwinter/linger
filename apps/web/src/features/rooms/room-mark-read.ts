import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

/**
 * The read cursor that clears a Room's unread Messages, or undefined when the
 * Room offers nothing to acknowledge. A count alone is not a cursor, so a Room
 * whose newest Message cannot advance past what this Human already read keeps
 * no action rather than sending a guessed sequence.
 */
export function roomMarkReadCursor(
  room: Pick<
    TeamHubRoomListItem,
    "latest_message" | "read_through_room_seq" | "unread_message_count"
  >,
): number | undefined {
  if (room.unread_message_count <= 0) return undefined;
  const latestRoomSeq = room.latest_message?.room_seq;
  if (
    latestRoomSeq === undefined ||
    !Number.isSafeInteger(latestRoomSeq) ||
    latestRoomSeq <= room.read_through_room_seq
  )
    return undefined;
  return latestRoomSeq;
}
