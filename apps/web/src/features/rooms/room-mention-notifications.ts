import { useEffect, useRef } from "react";

import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

const BODY_LIMIT = 160;

export interface RoomMentionNotice {
  messageId: string;
  roomId: string;
  title: string;
  body: string;
}

/**
 * The latest Message each Room's mentions were accounted through, or null for a
 * Room that had none yet. A Room outside the map has not been read.
 */
export type RoomMentionMessages = ReadonlyMap<string, string | null>;

/** Where the next reading starts for every Room in this one. */
export function roomMentionMessages(
  rooms: readonly TeamHubRoomListItem[],
): Map<string, string | null> {
  const messages = new Map<string, string | null>();
  for (const room of rooms) {
    messages.set(room.id, room.latest_message?.id ?? null);
  }
  return messages;
}

/**
 * The unread mentions to announce from one reading of the Room list. A Room
 * read for the first time is only recorded, as on the app's first reading, so
 * joining a Room or learning about Threads never replays old mentions. Threads
 * and the Room already on screen have their own place in the UI.
 */
export function roomMentionNotices(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId: string | undefined,
  seen: RoomMentionMessages | undefined,
): RoomMentionNotice[] {
  if (!seen) return [];
  return rooms.flatMap((room) => {
    const message = room.latest_message;
    if (
      !message ||
      room.kind === "thread" ||
      room.id === activeRoomId ||
      room.unread_mention_count === 0 ||
      !seen.has(room.id) ||
      seen.get(room.id) === message.id
    )
      return [];
    const text = markdownPlainText(message.raw_message).trim();
    if (!text) return [];
    return [
      {
        body: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text,
        messageId: message.id,
        roomId: room.id,
        title: room.name,
      },
    ];
  });
}

interface DesktopBadge {
  setBadgeCount(count: number): Promise<void>;
}

function desktopBadge(): DesktopBadge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as { lingerDesktop?: { notifications?: DesktopBadge } })
        .lingerDesktop?.notifications;
}

/**
 * Announces a new unread mention while this window is not in front, and keeps
 * the app icon's badge on the total unread mentions. Clicking a notification
 * brings the window back on its Room. Mentions read while focused are dropped
 * rather than shown late, because the Room list already showed them.
 */
export function useRoomMentionNotifications({
  open,
  roomId,
  rooms,
}: {
  open: (roomId: string) => void;
  roomId: string | undefined;
  rooms: readonly TeamHubRoomListItem[] | undefined;
}) {
  // undefined until the first reading, which is the baseline.
  const seen = useRef<RoomMentionMessages | undefined>(undefined);
  const badge = useRef<number | null>(null);

  useEffect(() => {
    if (!rooms) return;
    const notices = roomMentionNotices(rooms, roomId, seen.current);
    seen.current = roomMentionMessages(rooms);
    if (
      notices.length === 0 ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      document.hasFocus()
    )
      return;
    for (const notice of notices) {
      const notification = new Notification(notice.title, {
        body: notice.body,
        tag: notice.messageId,
      });
      notification.onclick = () => {
        window.focus();
        open(notice.roomId);
        notification.close();
      };
    }
  }, [open, roomId, rooms]);

  useEffect(() => {
    if (!rooms) return;
    const total = rooms.reduce(
      (sum, room) => sum + room.unread_mention_count,
      0,
    );
    // The Room list updates on every Message; the badge only changes when a
    // mention arrives or is read.
    if (badge.current === total) return;
    badge.current = total;
    void desktopBadge()?.setBadgeCount(total);
  }, [rooms]);
}
