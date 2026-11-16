import { describe, expect, it, vi } from "vitest";

import { nextWikiSurprise, wikiSurpriseIndex } from "./wiki-surprise";

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

describe("nextWikiSurprise", () => {
  const pages = [{ id: "launch" }, { id: "pricing" }, { id: "people" }];

  it("does not repeat a page until the others have been opened", () => {
    const first = nextWikiSurprise(pages, [], fixed(0));
    expect(first?.page.id).toBe("launch");
    const second = nextWikiSurprise(pages, first?.seenIds ?? [], fixed(0));
    expect(second?.page.id).toBe("pricing");
    const third = nextWikiSurprise(pages, second?.seenIds ?? [], fixed(0));
    expect(third?.page.id).toBe("people");
    const again = nextWikiSurprise(pages, third?.seenIds ?? [], fixed(0));
    expect(again?.page.id).toBe("launch");
    expect(again?.seenIds).toEqual(["launch"]);
  });

  it("returns nothing when there are no pages", () => {
    expect(nextWikiSurprise([], [], fixed(0))).toBeUndefined();
  });
});
