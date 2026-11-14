import { describe, expect, it } from "vitest";

import { messageQuoteText } from "./message-quote";
import { quoteReplyFromMessage } from "./quote-reply";

/** A local time string, so the expected clock time is the same everywhere. */
const createdAt = "2026-11-14T09:12:00";

describe("quoteReplyFromMessage", () => {
  it("quotes exactly the block Copy as quote writes", () => {
    const input = {
      authorName: "Ada Lovelace",
      createdAt,
      message: "The migration finished; the queue is empty.",
    };
    expect(quoteReplyFromMessage(input).quote).toBe(messageQuoteText(input));
  });

  it("names the author and collapses the text to one line", () => {
    expect(
      quoteReplyFromMessage({
        authorName: "Ada Lovelace",
        createdAt,
        message: "First line.\n\nSecond line.",
      }),
    ).toMatchObject({
      authorName: "Ada Lovelace",
      preview: "First line. Second line.",
    });
  });

  it("cuts a long preview and marks the cut", () => {
    const reply = quoteReplyFromMessage({
      authorName: "Ada Lovelace",
      createdAt,
      message: "word ".repeat(80),
    });
    expect(reply.preview).toHaveLength(140);
    expect(reply.preview.endsWith("…")).toBe(true);
  });

  it("names an unknown author the way the quote does", () => {
    expect(
      quoteReplyFromMessage({
        authorName: undefined,
        createdAt,
        message: "Hi",
      }),
    ).toMatchObject({ authorName: "Unknown author" });
  });
});
