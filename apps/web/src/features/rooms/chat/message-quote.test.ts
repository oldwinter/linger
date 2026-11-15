import { describe, expect, it } from "vitest";

import { messageQuoteText } from "./message-quote";

/** A local time string, so the expected clock time is the same everywhere. */
const createdAt = "2026-11-14T09:12:00";

describe("messageQuoteText", () => {
  it("quotes the author, time and text as one block", () => {
    expect(
      messageQuoteText({
        authorName: "Ada Lovelace",
        createdAt,
        message: "The migration finished; the queue is empty.",
      }),
    ).toBe(
      [
        "> Ada Lovelace, 2026-11-14 09:12",
        ">",
        "> The migration finished; the queue is empty.",
      ].join("\n"),
    );
  });

  it("keeps blank lines inside the quote and drops trailing ones", () => {
    expect(
      messageQuoteText({
        authorName: "Ada Lovelace",
        createdAt,
        message: "First line.\n\nSecond line.\n\n\n",
      }),
    ).toBe(
      [
        "> Ada Lovelace, 2026-11-14 09:12",
        ">",
        "> First line.",
        ">",
        "> Second line.",
      ].join("\n"),
    );
  });

  it("quotes readable text rather than Markdown syntax or a code fence", () => {
    expect(
      messageQuoteText({
        authorName: "Ada Lovelace",
        createdAt,
        message: "## Update\n\n- **Shipped** `v2`\n\n```\nraw code\n```",
      }),
    ).toBe(
      [
        "> Ada Lovelace, 2026-11-14 09:12",
        ">",
        "> Update",
        ">",
        "> Shipped v2",
        ">",
        "> raw code",
      ].join("\n"),
    );
  });

  it("leaves the author line when the Message has no readable text", () => {
    expect(
      messageQuoteText({
        authorName: "Ada Lovelace",
        createdAt,
        message: " \n\n",
      }),
    ).toBe("> Ada Lovelace, 2026-11-14 09:12");
  });

  it("names an unknown author neutrally instead of leaving a gap", () => {
    expect(
      messageQuoteText({
        authorName: undefined,
        createdAt,
        message: "Handled.",
      }),
    ).toBe(
      ["> Unknown author, 2026-11-14 09:12", ">", "> Handled."].join("\n"),
    );
  });
});
