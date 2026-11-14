import { escapeLinkText } from "@/features/library/library-selection-links";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { roomChatPath } from "./room-routes";

/** The name the Room list shows: a direct chat shows its peer, not the Room. */
function roomListDisplayName(room: TeamHubRoomListItem) {
  if (room.kind !== "direct") return room.name;
  return room.direct_peer?.display_name ?? room.name;
}

/** The row's attention badge, as words: mentions win over Messages. */
function roomUnreadLabel(room: TeamHubRoomListItem) {
  if (room.unread_mention_count > 0) {
    return `${room.unread_mention_count} unread mention${
      room.unread_mention_count === 1 ? "" : "s"
    }`;
  }
  if (room.unread_message_count > 0) {
    return `${room.unread_message_count} unread message${
      room.unread_message_count === 1 ? "" : "s"
    }`;
  }
  return undefined;
}

/**
 * The Room list as a Markdown checklist: a heading, then one linked entry per
 * Room in the order received, with the unread state the row shows. The caller
 * passes the rows on screen, so pinned Rooms lead and snoozed Rooms never
 * appear. A name stays plain link text.
 */
export function roomListMarkdown({
  origin,
  rooms,
  tenantId,
}: {
  origin: string;
  rooms: readonly TeamHubRoomListItem[];
  tenantId: string;
}): string {
  return [
    "# Messages",
    ...rooms.map((room) => {
      const url = new URL(roomChatPath(tenantId, room.id), origin).toString();
      const unread = roomUnreadLabel(room);
      const entry = `- [${escapeLinkText(roomListDisplayName(room))}](${url})`;
      return unread ? `${entry} (${unread})` : entry;
    }),
  ].join("\n");
}
