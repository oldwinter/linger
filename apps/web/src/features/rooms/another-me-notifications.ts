import { useEffect, useRef } from "react";

import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  isDesktopNotificationPaused,
  useDesktopNotificationPause,
} from "./desktop-notification-pause";

const BODY_LIMIT = 160;

export interface AnotherMeNotice {
  messageId: string;
  title: string;
  body: string;
}

/**
 * The system notice for the Another Me Chat's latest Message, when it is a new
 * one from the Another Me itself. The first reading only records the latest
 * Message, so loading the app never replays an old one.
 */
export function anotherMeNotice(
  room: TeamHubRoomListItem | undefined,
  agentActorId: string | undefined,
  seenMessageId: string | null | undefined,
): AnotherMeNotice | undefined {
  const message = room?.latest_message;
  if (!message || !agentActorId || seenMessageId === undefined) return;
  if (message.id === seenMessageId || message.author.id !== agentActorId)
    return;
  const text = markdownPlainText(message.raw_message).trim();
  if (!text) return;
  return {
    messageId: message.id,
    title: message.author.display_name,
    body: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text,
  };
}

/**
 * Shows a system notification when the Another Me posts in its Chat while this
 * window is not in front, such as a proactive reminder. Clicking it brings the
 * window back on that Chat. Nothing is shown until the Human allowed
 * notifications; the desktop app allows them for its own server. A pause holds
 * the notice back without losing it: the first reading still records where to
 * start, and the Message shows once the pause ends.
 */
export function useAnotherMeNotifications({
  accountId,
  rooms,
  roomId,
  agentActorId,
  open,
}: {
  accountId?: string;
  rooms: readonly TeamHubRoomListItem[] | undefined;
  roomId: string | undefined;
  agentActorId: string | undefined;
  open: (roomId: string) => void;
}) {
  // undefined until the first reading; null when the Chat had no Message yet.
  const seen = useRef<string | null | undefined>(undefined);
  const paused = isDesktopNotificationPaused(
    useDesktopNotificationPause(accountId),
    new Date(),
  );
  const room = roomId ? rooms?.find((item) => item.id === roomId) : undefined;

  useEffect(() => {
    if (!rooms || !roomId) return;
    if (paused && seen.current !== undefined) return;
    const notice = anotherMeNotice(room, agentActorId, seen.current);
    seen.current = room?.latest_message?.id ?? null;
    if (paused) return;
    if (
      !notice ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      document.hasFocus()
    )
      return;
    const notification = new Notification(notice.title, {
      body: notice.body,
      tag: notice.messageId,
    });
    notification.onclick = () => {
      window.focus();
      open(roomId);
      notification.close();
    };
  }, [agentActorId, open, paused, room, roomId, rooms]);
}
