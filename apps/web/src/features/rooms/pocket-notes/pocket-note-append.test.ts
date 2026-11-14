import { describe, expect, it } from "vitest";

import { messageQuoteText } from "../chat/message-quote";
import { appendToPocketNote } from "./pocket-note-append";

describe("Appending to a Pocket Note", () => {
  it("starts an empty page with the block and no blank line", () => {
    expect(appendToPocketNote("", "> Alice")).toBe("> Alice");
    expect(appendToPocketNote(" \n\t", "> Alice")).toBe("> Alice");
  });

  it("separates the block from existing text with one blank line", () => {
    expect(appendToPocketNote("Buy milk", "> Alice")).toBe(
      "Buy milk\n\n> Alice",
    );
  });

  it("keeps one blank line when the page already indents the break", () => {
    expect(appendToPocketNote("Buy milk\n", "> Alice")).toBe(
      "Buy milk\n\n> Alice",
    );
    expect(appendToPocketNote("Buy milk\n\n", "> Alice")).toBe(
      "Buy milk\n\n> Alice",
    );
  });

  it("ignores a blank block", () => {
    expect(appendToPocketNote("Buy milk", "  \n ")).toBe("Buy milk");
    expect(appendToPocketNote("", "")).toBe("");
  });

  it("adds a quoted message under its author", () => {
    const quote = messageQuoteText({
      authorName: "Alice",
      createdAt: "2026-11-15T08:00:00Z",
      message: "Ship **the** release",
    });

    const text = appendToPocketNote("Morning ideas", quote);

    expect(text.startsWith("Morning ideas\n\n> Alice, ")).toBe(true);
    expect(text).toContain("\n>\n> Ship the release");
  });
});
