import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/** The chat route for a Room. A thread is a Room, so both share this shape. */
export function roomChatPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;
}

/**
 * A link that opens a Message's Room at that Message. A thread reply's Room is
 * the thread, so the same link opens the reply inside its thread.
 */
export function roomMessagePath(
  tenantId: string,
  message: Pick<TeamHubMessage, "id" | "room_id">,
) {
  return `${roomChatPath(tenantId, message.room_id)}?message=${encodeURIComponent(message.id)}`;
}
