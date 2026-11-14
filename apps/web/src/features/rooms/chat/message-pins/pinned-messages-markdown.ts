import { roomMessagePath } from "../../room-routes";
import { messageBodyText } from "../message-plain-text";
import { messageLocalTime, messageQuoteAuthor } from "../message-quote";

/** One pin as the panel shows it: its Message's author, time, and text. */
export interface PinnedMessagesMarkdownPin {
  message: {
    author: { display_name: string };
    created_at: string;
    id: string;
    raw_message: string;
    room_id: string;
  };
}

/**
 * The pins the panel currently lists, in their displayed order, as one
 * Markdown document: a heading naming the Room, then each pin's author and
 * local time, its readable body, and a link that opens the Room at that
 * Message. A pin with no readable body keeps its author line and link, and an
 * unknown author is named the same way Copy as quote names it.
 */
export function pinnedMessagesMarkdown(input: {
  /** The page origin the copied links open on. */
  origin: string;
  pins: readonly PinnedMessagesMarkdownPin[];
  roomName: string;
  tenantId: string;
}): string {
  if (!input.pins.length) return "";
  return [
    `# Pinned messages in ${input.roomName}`,
    ...input.pins.map((pin) => pinSection(pin, input)),
  ].join("\n\n");
}

function pinSection(
  pin: PinnedMessagesMarkdownPin,
  input: { origin: string; tenantId: string },
): string {
  const head = `**${messageQuoteAuthor(pin.message.author.display_name)}, ${messageLocalTime(pin.message.created_at)}**`;
  const body = messageBodyText(pin.message.raw_message).trimEnd();
  const link = new URL(
    roomMessagePath(input.tenantId, pin.message),
    input.origin,
  ).toString();
  return body ? `${head}\n${body}\n${link}` : `${head}\n${link}`;
}
