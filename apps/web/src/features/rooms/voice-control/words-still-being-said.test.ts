import { describe, expect, it } from "vitest";

import {
  unfinishedWhileSaving,
  wordsStillBeingSaid,
} from "./words-still-being-said";

describe("wordsStillBeingSaid", () => {
  it("keeps only the words past the last confirmed line", () => {
    expect(
      wordsStillBeingSaid("Confirmed live transcript and more", [
        { text: "Confirmed live transcript" },
      ]),
    ).toBe("and more");
    expect(
      wordsStillBeingSaid("Confirmed live transcript", [
        { text: "Confirmed live transcript" },
      ]),
    ).toBeUndefined();
    expect(
      wordsStillBeingSaid("Recognizing this sentence live", [
        { text: "Confirmed live transcript" },
      ]),
    ).toBe("Recognizing this sentence live");
  });
});

describe("unfinishedWhileSaving", () => {
  it("keeps the unfinished words while saving until a confirmed line arrives", () => {
    const held = { count: 1, text: "still saying this" };
    expect(unfinishedWhileSaving(undefined, 1, held, true)).toBe(
      "still saying this",
    );
    expect(unfinishedWhileSaving(undefined, 2, held, true)).toBeUndefined();
    expect(unfinishedWhileSaving(undefined, 1, held, false)).toBeUndefined();
    expect(unfinishedWhileSaving("and more", 1, held, true)).toBe("and more");
  });
});
