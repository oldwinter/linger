import { describe, expect, it } from "vitest";

import { threadMarkdown } from "./thread-markdown";

/** Local time strings, so the printed clock is the same everywhere. */
const firstAt = "2026-11-14T09:12:00";
const secondAt = "2026-11-14T09:20:00";

describe("threadMarkdown", () => {
  it("names the Thread once and gives one message its author, time and body", () => {
    expect(
      threadMarkdown([
        {
          authorName: "Ada Lovelace",
          createdAt: firstAt,
          message: "The migration finished.",
        },
      ]),
    ).toBe(
      [
        "# Thread",
        "**Ada Lovelace, 2026-11-14 09:12**\nThe migration finished.",
      ].join("\n\n"),
    );
  });

  it("writes several messages in display order with one blank line between", () => {
    expect(
      threadMarkdown([
        {
          authorName: "Ada Lovelace",
          createdAt: firstAt,
          message: "First line.\n\nSecond line.",
        },
        {
          authorName: "Casey Example",
          createdAt: secondAt,
          message: "A reply.",
        },
      ]),
    ).toBe(
      [
        "# Thread",
        "**Ada Lovelace, 2026-11-14 09:12**\nFirst line.\n\nSecond line.",
        "**Casey Example, 2026-11-14 09:20**\nA reply.",
      ].join("\n\n"),
    );
  });

  it("names an unknown author the way Copy as quote does", () => {
    const expected = [
      "# Thread",
      "**Unknown author, 2026-11-14 09:12**\nHandled.",
    ].join("\n\n");

    for (const authorName of [undefined, null, "", "   "]) {
      expect(
        threadMarkdown([
          { authorName, createdAt: firstAt, message: "Handled." },
        ]),
      ).toBe(expected);
    }
  });

  it("keeps the author line for a message with no readable body", () => {
    expect(
      threadMarkdown([
        { authorName: "Ada Lovelace", createdAt: firstAt, message: " \n\n" },
        { authorName: "Casey Example", createdAt: secondAt, message: "Reply." },
      ]),
    ).toBe(
      [
        "# Thread",
        "**Ada Lovelace, 2026-11-14 09:12**",
        "**Casey Example, 2026-11-14 09:20**\nReply.",
      ].join("\n\n"),
    );
  });

  it("writes the readable body rather than Markdown syntax", () => {
    expect(
      threadMarkdown([
        {
          authorName: "Ada Lovelace",
          createdAt: firstAt,
          message: "## Update\n\n- **Shipped** `v2`\n\n```\nraw code\n```",
        },
      ]),
    ).toBe(
      [
        "# Thread",
        "**Ada Lovelace, 2026-11-14 09:12**\nUpdate\n\nShipped v2\n\nraw code",
      ].join("\n\n"),
    );
  });

  it("writes nothing for a Thread with no messages", () => {
    expect(threadMarkdown([])).toBe("");
  });

  it("writes the same text for the same input", () => {
    const messages = [
      { authorName: "Ada Lovelace", createdAt: firstAt, message: "One." },
      { createdAt: secondAt, message: "Two." },
    ];

    expect(threadMarkdown(messages)).toBe(threadMarkdown(messages));
  });
});
