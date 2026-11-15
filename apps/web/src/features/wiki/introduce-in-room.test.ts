import { describe, expect, it } from "vitest";

import {
  introductionIdempotencyKey,
  introductionMessage,
} from "./introduce-in-room";

describe("introductionMessage", () => {
  it("leads with what the message is, then the lines", () => {
    expect(
      introductionMessage([
        "This is Jenny.",
        "Talk to Jenny like this: plainly.",
      ]),
    ).toBe(
      [
        "How Another Me would introduce you",
        "",
        "This is Jenny.",
        "Talk to Jenny like this: plainly.",
      ].join("\n"),
    );
  });

  it("changes the retry key when the introduction changes", () => {
    const first = introductionIdempotencyKey("room-1", "This is Jenny.");
    const again = introductionIdempotencyKey("room-1", "This is Jenny.");
    const other = introductionIdempotencyKey("room-1", "This is Mina.");
    expect(first).toBe(again);
    expect(other).not.toBe(first);
    expect(first.startsWith("introduce:room-1:")).toBe(true);
  });
});
