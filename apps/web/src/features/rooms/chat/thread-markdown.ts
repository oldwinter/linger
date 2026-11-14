import { messageBodyText } from "./message-plain-text";
import { messageLocalTime, messageQuoteAuthor } from "./message-quote";

/** One Message as the Thread shows it: who, when, and the readable body. */
export interface ThreadMarkdownMessage {
  /** The name the row shows for the author; absent when nobody knows it. */
  authorName?: string | null;
  createdAt: string;
  message: string;
}

const threadTitle = "# Thread";

/**
 * The Thread's messages in display order as one Markdown document: a title,
 * then each message as its author and local time above the readable body. A
 * message with no readable body keeps its author line, an unknown author is
 * named the same way Copy as quote names it, and no message is reordered or
 * dropped.
 */
export function threadMarkdown(
  messages: readonly ThreadMarkdownMessage[],
): string {
  if (!messages.length) return "";
  return [threadTitle, ...messages.map(messageSection)].join("\n\n");
}

function messageSection(input: ThreadMarkdownMessage): string {
  const head = `**${messageQuoteAuthor(input.authorName)}, ${messageLocalTime(input.createdAt)}**`;
  const body = messageBodyText(input.message).trimEnd();
  return body ? `${head}\n${body}` : head;
}
