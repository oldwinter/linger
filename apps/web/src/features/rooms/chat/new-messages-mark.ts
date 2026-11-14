import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { tenantRoomsQueryOptions } from "../room-queries";

/**
 * Index of the first Message that was unread when the Room opened.
 * The count ignores the reader's own Messages, matching the Room badge.
 * When more Messages are unread than the loaded page holds, the mark sits
 * at the top of what is loaded.
 */
export function newMessagesStartIndex(
  messages: readonly { authorId: string }[],
  currentActorId: string | undefined,
  unreadCount: number,
): number | undefined {
  if (unreadCount <= 0 || messages.length === 0) return;
  let remaining = unreadCount;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.authorId === currentActorId) continue;
    remaining -= 1;
    if (remaining === 0) return index;
  }
  return 0;
}

/**
 * The unread count from the first time this Room's list is known. Later
 * reads clear the badge, and the mark stays where the reader found it.
 */
export function useOpenedUnreadCount(tenantId: string, roomId: string) {
  const { client } = useTeamHubRuntime();
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const [captured, setCaptured] = useState<{
    roomId: string;
    count: number;
  } | null>(null);
  if (rooms.data && captured?.roomId !== roomId) {
    const count =
      rooms.data.items.find((room) => room.id === roomId)
        ?.unread_message_count ?? 0;
    setCaptured({ roomId, count });
  }
  return captured?.roomId === roomId ? captured.count : 0;
}
