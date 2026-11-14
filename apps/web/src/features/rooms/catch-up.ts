import { isRecord } from "@linger/service-kit";

import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

const previewLimit = 160;
const storagePrefix = "linger.catch-up.";

/** One chat frozen when a catch-up walk starts. */
export interface CatchUpRoom {
  id: string;
  name: string;
  preview: string;
  unreadMentions: number;
  unreadMessages: number;
}

/** The walk, including a finished one whose index sits past the last chat. */
export interface CatchUpWalk {
  index: number;
  rooms: CatchUpRoom[];
}

/** Chats with new messages or mentions, in list order. Thread rooms stay out. */
export function beginCatchUp(
  rooms: readonly TeamHubRoomListItem[],
): CatchUpWalk {
  return {
    index: 0,
    rooms: rooms.flatMap((room) => {
      if (room.kind === "thread") return [];
      if (room.unread_message_count === 0 && room.unread_mention_count === 0) {
        return [];
      }
      const preview = room.latest_message
        ? markdownPlainText(room.latest_message.raw_message).trim()
        : "";
      return [
        {
          id: room.id,
          name: room.direct_peer?.display_name || room.name,
          preview:
            preview.length > previewLimit
              ? `${preview.slice(0, previewLimit)}…`
              : preview,
          unreadMentions: room.unread_mention_count,
          unreadMessages: room.unread_message_count,
        },
      ];
    }),
  };
}

/** The frozen counts, as a sentence. */
export function catchUpAttention(room: CatchUpRoom): string {
  const messages =
    room.unreadMessages === 1
      ? "1 new message"
      : `${room.unreadMessages} new messages`;
  const mentions =
    room.unreadMentions === 1 ? "1 mention" : `${room.unreadMentions} mentions`;
  if (room.unreadMentions === 0) return `${messages} when you started`;
  if (room.unreadMessages === 0) return `${mentions} when you started`;
  return `${messages} and ${mentions} when you started`;
}

function storageKey(accountId: string, tenantId: string) {
  return `${storagePrefix}${encodeURIComponent(accountId)}.${encodeURIComponent(tenantId)}`;
}

function isCatchUpRoom(value: unknown): value is CatchUpRoom {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.preview === "string" &&
    typeof value.unreadMentions === "number" &&
    typeof value.unreadMessages === "number"
  );
}

/**
 * The walk for this account on this computer's tab. Opening a chat clears
 * its live badge; the stored walk keeps the rest of the list.
 */
export function readCatchUpWalk(
  accountId: string,
  tenantId: string,
): CatchUpWalk | undefined {
  try {
    const stored = globalThis.sessionStorage?.getItem(
      storageKey(accountId, tenantId),
    );
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (
      !isRecord(parsed) ||
      typeof parsed.index !== "number" ||
      !Array.isArray(parsed.rooms) ||
      !parsed.rooms.every(isCatchUpRoom)
    ) {
      return;
    }
    return { index: parsed.index, rooms: parsed.rooms };
  } catch {
    return;
  }
}

export function writeCatchUpWalk(
  accountId: string,
  tenantId: string,
  walk: CatchUpWalk,
) {
  try {
    globalThis.sessionStorage?.setItem(
      storageKey(accountId, tenantId),
      JSON.stringify(walk),
    );
  } catch {
    // The walk still advances in memory when the tab cannot store it.
  }
}

export function clearCatchUpWalk(accountId: string, tenantId: string) {
  try {
    globalThis.sessionStorage?.removeItem(storageKey(accountId, tenantId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
