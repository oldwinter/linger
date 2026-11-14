import { describe, expect, it } from "vitest";

import {
  POCKET_NOTE_TEXT_LIMIT,
  pocketCaptureLine,
  withPocketCapture,
} from "./pocket-note-capture";

describe("Pocket capture", () => {
  it("keeps the author and collapses the message onto one line", () => {
    expect(pocketCaptureLine("Codex", "  Launch\nis Thursday.  ")).toBe(
      "Codex: Launch is Thursday.",
    );
    expect(pocketCaptureLine("  ", "   ")).toBe("");
    expect(pocketCaptureLine("", "Remember the orchids")).toBe(
      "Someone: Remember the orchids",
    );
  });

  it("appends a line, skips a repeat, and refuses a page past the limit", () => {
    expect(withPocketCapture("Buy milk", "Codex: Launch is Thursday.")).toEqual(
      {
        text: "Buy milk\nCodex: Launch is Thursday.",
        added: true,
      },
    );
    expect(withPocketCapture("", "Codex: Launch is Thursday.")).toEqual({
      text: "Codex: Launch is Thursday.",
      added: true,
    });
    expect(
      withPocketCapture(
        "Buy milk\nCodex: Launch is Thursday.",
        "Codex: Launch is Thursday.",
      ),
    ).toEqual({
      text: "Buy milk\nCodex: Launch is Thursday.",
      added: false,
    });
    const line = `Ada: ${"x".repeat(20)}`;
    expect(
      withPocketCapture("y".repeat(POCKET_NOTE_TEXT_LIMIT - 2), line),
    ).toBeUndefined();
  });
});
