import { describe, expect, it } from "vitest";

import { messagePlainText } from "./message-plain-text";
import { messageQuoteText } from "./message-quote";

describe("messagePlainText", () => {
  it("keeps line breaks and ends with one final newline", () => {
    expect(messagePlainText("First line.\n\nSecond line.\n\n\n")).toBe(
      "First line.\n\nSecond line.\n",
    );
  });

  it("keeps mention labels and link text as the reader sees them", () => {
    expect(
      messagePlainText(
        "Thanks @Casey Example, see [the runbook](https://example.com/runbook).\n\n```\nraw code\n```",
      ),
    ).toBe("Thanks @Casey Example, see the runbook.\n\nraw code\n");
  });

  it("writes nothing for a Message with no readable text", () => {
    expect(messagePlainText(" \n\n")).toBe("");
  });

  it("differs from the quote only by its quote markers", () => {
    const message =
      "Update:\n\n- **Shipped** `v2` with @Casey Example\n\nThanks!";

    const plain = messagePlainText(message);
    const quote = messageQuoteText({
      authorName: "Ada Lovelace",
      createdAt: "2026-11-14T09:12:00",
      message,
    });

    const [head, blank, ...quoted] = quote.split("\n");
    expect(head).toBe("> Ada Lovelace, 2026-11-14 09:12");
    expect(blank).toBe(">");
    expect(quoted.map((line) => line.replace(/^> ?/u, "")).join("\n")).toBe(
      plain.trimEnd(),
    );
  });
});
