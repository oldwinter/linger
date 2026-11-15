import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { messageLink } from "./message-link";

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
  return messageLink(roomChatPath(tenantId, message.room_id), message.id);
}

/**
 * A Message's link with its origin, so it opens from a document or another
 * app rather than only inside this page.
 */
export function roomMessageUrl(
  origin: string,
  tenantId: string,
  message: Pick<TeamHubMessage, "id" | "room_id">,
) {
  return new URL(roomMessagePath(tenantId, message), origin).toString();
}
