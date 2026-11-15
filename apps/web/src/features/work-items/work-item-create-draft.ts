import { messageQuoteText } from "@/features/rooms/chat/message-quote";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubWorkItemPriority } from "@/features/teamhub/teamhub-types";

/** The contract's title bound, which the create dialog enforces. */
export const WORK_ITEM_TITLE_LIMIT = 240;

/** What the create dialog needs to open on someone's behalf. */
export interface WorkItemCreateDraft {
  description: string;
  originRoomId: string;
  /** The dialog's own default applies when the surface has no preference. */
  priority?: TeamHubWorkItemPriority;
  title: string;
}

/**
 * A draft issue started from one Message: its first readable line as the
 * title, the Message quoted with its author, and the Room it was sent in.
 */
export function messageWorkItemDraft(input: {
  authorName?: string | null;
  createdAt: string;
  message: string;
  roomId: string;
}): WorkItemCreateDraft {
  return {
    description: messageQuoteText({
      authorName: input.authorName,
      createdAt: input.createdAt,
      message: input.message,
    }),
    originRoomId: input.roomId,
    title: workItemTitle(markdownPlainText(input.message)),
  };
}

/** A title from plain text: its first non-empty line, within the limit. */
export function workItemTitle(plainText: string): string {
  const firstLine =
    plainText
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return truncateWorkItemTitle(firstLine, WORK_ITEM_TITLE_LIMIT);
}

/** A title within the contract's bound, which the create dialog submits under. */
export function truncateWorkItemTitle(value: string, limit: number) {
  if (value.length <= limit) return value;
  // Cutting between a surrogate pair would leave a lone code unit.
  const lastKept = value.charCodeAt(limit - 1);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? limit - 1 : limit;
  return value.slice(0, end);
}
