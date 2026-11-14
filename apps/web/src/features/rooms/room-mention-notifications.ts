import { useEffect, useRef } from "react";

import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  isDesktopNotificationPaused,
  useDesktopNotificationPause,
} from "./desktop-notification-pause";
import {
  quietRoomIds,
  useRoomMentionMute,
  useRoomMentionSnooze,
} from "./room-mention-snooze";

const BODY_LIMIT = 160;

const NO_QUIET_ROOMS: ReadonlySet<string> = new Set();

export interface RoomMentionNotice {
  /** The Message that announced the mention; absent for a Room-level notice. */
  messageId?: string;
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
 * joining a Room or learning about Threads never replays old mentions. Threads,
 * the Room already on screen, and Rooms whose mentions are quiet have their
 * own place in the UI.
 */
export function roomMentionNotices(
  rooms: readonly TeamHubRoomListItem[],
  activeRoomId: string | undefined,
  seen: RoomMentionMessages | undefined,
  quietRooms: ReadonlySet<string> = NO_QUIET_ROOMS,
): RoomMentionNotice[] {
  if (!seen) return [];
  return rooms.flatMap((room) => {
    const message = room.latest_message;
    if (
      !message ||
      room.kind === "thread" ||
      room.id === activeRoomId ||
      quietRooms.has(room.id) ||
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
 * brings the window back on its Room, and on the Message it announced when the
 * notice names one. Mentions read while focused are dropped rather than shown
 * late, because the Room list already showed them. A Room whose mentions are
 * snoozed or muted raises neither a notification nor a badge count, while the
 * Room list keeps its own unread numbers. While paused nothing is shown and
 * the badge stays empty, and the mention that arrives during it shows once the
 * pause ends.
 */
export function useRoomMentionNotifications({
  accountId,
  open,
  roomId,
  rooms,
}: {
  accountId?: string;
  open: (roomId: string, messageId?: string) => void;
  roomId: string | undefined;
  rooms: readonly TeamHubRoomListItem[] | undefined;
}) {
  // undefined until the first reading, which is the baseline.
  const seen = useRef<RoomMentionMessages | undefined>(undefined);
  const badge = useRef<number | null>(null);
  const snooze = useRoomMentionSnooze(accountId);
  const mute = useRoomMentionMute(accountId);
  const paused = isDesktopNotificationPaused(
    useDesktopNotificationPause(accountId),
    new Date(),
  );

  useEffect(() => {
    if (!rooms) return;
    // A pause holds notices back without losing them: the first reading still
    // records where to start, and later readings wait for the pause to end.
    if (paused && seen.current !== undefined) return;
    const notices = roomMentionNotices(
      rooms,
      roomId,
      seen.current,
      quietRoomIds(snooze, mute, new Date()),
    );
    seen.current = roomMentionMessages(rooms);
    if (paused) return;
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
        open(notice.roomId, notice.messageId);
        notification.close();
      };
    }
  }, [mute, open, paused, roomId, rooms, snooze]);

  useEffect(() => {
    if (!rooms) return;
    const quiet = quietRoomIds(snooze, mute, new Date());
    const total = paused
      ? 0
      : rooms.reduce(
          (sum, room) =>
            quiet.has(room.id) ? sum : sum + room.unread_mention_count,
          0,
        );
    // The Room list updates on every Message; the badge only changes when a
    // mention arrives, is read, or its Room turns quiet.
    if (badge.current === total) return;
    badge.current = total;
    void desktopBadge()?.setBadgeCount(total);
  }, [mute, paused, rooms, snooze]);
}
