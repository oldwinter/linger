import { useEffect, useState } from "react";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

const DISPLAY_LIMIT = 99;

/**
 * The compact count a window title shows for unread activity, or null when
 * nothing is unread. A Thread is a reply the parent Room already counts, and a
 * mention is an unread Message too, so mentions only fill in when no Room
 * counts their Messages.
 */
export function unreadTitleLabel(
  rooms: readonly TeamHubRoomListItem[],
): string | null {
  let messages = 0;
  let mentions = 0;
  for (const room of rooms) {
    if (room.kind === "thread") continue;
    messages += room.unread_message_count;
    mentions += room.unread_mention_count;
  }
  const count = messages > 0 ? messages : mentions;
  if (count === 0) return null;
  return `(${count > DISPLAY_LIMIT ? `${DISPLAY_LIMIT}+` : count})`;
}

/** The window title for a Room list: the base title, prefixed when unread. */
export function roomWindowTitle(
  baseTitle: string,
  rooms: readonly TeamHubRoomListItem[],
): string {
  const label = unreadTitleLabel(rooms);
  return label ? `${label} ${baseTitle}` : baseTitle;
}

/**
 * Keeps the window title on the caller's base title plus unread activity. The
 * document's title at mount is restored on unmount, so leaving the shell does
 * not leave a count behind.
 */
export function useRoomWindowTitle({
  baseTitle,
  rooms,
}: {
  baseTitle: string;
  rooms: readonly TeamHubRoomListItem[] | undefined;
}): void {
  const [originalTitle] = useState(() => document.title);

  useEffect(() => {
    document.title = rooms ? roomWindowTitle(baseTitle, rooms) : baseTitle;
  }, [baseTitle, rooms]);

  useEffect(
    () => () => {
      document.title = originalTitle;
    },
    [originalTitle],
  );
}
