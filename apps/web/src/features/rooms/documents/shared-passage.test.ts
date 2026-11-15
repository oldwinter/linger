import { describe, expect, it } from "vitest";

import {
  SHARED_WORD_MS,
  caretOutsideSharedWord,
  liveActorIds,
} from "./shared-passage";

describe("caretOutsideSharedWord", () => {
  it("places the next character after a word someone else is in", () => {
    expect(caretOutsideSharedWord("hello world", 2, [4])).toBe(5);
    expect(caretOutsideSharedWord("hello world", 5, [4])).toBeUndefined();
    expect(caretOutsideSharedWord("hello world", 2, [8])).toBeUndefined();
    expect(caretOutsideSharedWord("hello world", 5, [8])).toBeUndefined();
  });
});

describe("liveActorIds", () => {
  it("keeps only the people who moved just now", () => {
    const now = 10_000;
    expect(
      liveActorIds(
        new Map([
          ["ada", now - 500],
          ["sam", now - SHARED_WORD_MS - 1],
        ]),
        now,
      ),
    ).toEqual(new Set(["ada"]));
  });
});
