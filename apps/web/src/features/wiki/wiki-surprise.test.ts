import { describe, expect, it, vi } from "vitest";

import { wikiSurpriseIndex } from "./wiki-surprise";

/** A random source that always returns the same fraction. */
const fixed = (value: number) => () => value;

describe("wikiSurpriseIndex", () => {
  it("offers nothing when there are no pages", () => {
    const random = vi.fn(fixed(0.5));
    expect(wikiSurpriseIndex({ count: 0, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("opens the only page even when it is the one on screen", () => {
    expect(
      wikiSurpriseIndex({ count: 1, currentIndex: 0, random: fixed(0.5) }),
    ).toBe(0);
  });

  it("skips the page on screen when there is another one", () => {
    expect(
      wikiSurpriseIndex({ count: 2, currentIndex: 0, random: fixed(0) }),
    ).toBe(1);
    expect(
      wikiSurpriseIndex({ count: 2, currentIndex: 1, random: fixed(0) }),
    ).toBe(0);
  });

  it("walks the remaining pages in order for a fixed random source", () => {
    const index = (randomValue: number) =>
      wikiSurpriseIndex({
        count: 4,
        currentIndex: 1,
        random: fixed(randomValue),
      });
    expect([0.01, 0.5, 0.7, 0.99].map(index)).toEqual([0, 2, 3, 3]);
  });

  it("answers the same question the same way", () => {
    const ask = () =>
      wikiSurpriseIndex({ count: 7, currentIndex: 4, random: fixed(0.42) });
    expect(ask()).toBe(ask());
  });

  it("ignores a current index outside the list", () => {
    expect(
      wikiSurpriseIndex({ count: 3, currentIndex: 9, random: fixed(0.5) }),
    ).toBe(1);
  });
});
