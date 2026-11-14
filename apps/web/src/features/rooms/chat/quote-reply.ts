import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

import { messageQuoteAuthor, messageQuoteText } from "./message-quote";

/** How much of the Message's text the composer strip shows. */
const previewLength = 140;

export interface StagedQuoteReply {
  /** The name the strip shows; the quote block carries the same name. */
  authorName: string;
  /** One line of the Message text for the strip. */
  preview: string;
  /** The Markdown blockquote the composer text starts with. */
  quote: string;
}

/**
 * A Message staged as a quoted reply. The quote is the text Copy as quote
 * writes, so the two cannot disagree; the preview is display only, because the
 * body already carries the quoted Message.
 */
export function quoteReplyFromMessage(input: {
  authorName?: string | null;
  createdAt: string;
  message: string;
}): StagedQuoteReply {
  const plain = markdownPlainText(input.message).replace(/\s+/gu, " ").trim();
  return {
    authorName: messageQuoteAuthor(input.authorName),
    preview:
      plain.length > previewLength
        ? `${plain.slice(0, previewLength - 1)}…`
        : plain,
    quote: messageQuoteText(input),
  };
}
