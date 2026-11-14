import { describe, expect, it } from "vitest";

import { filterWikiEntries } from "./wiki-title-filter";

const titles = ["Alpha launch notes", "Beta launch plan", "Gamma design"];

describe("filterWikiEntries", () => {
  it("keeps every entry, unchanged, for an empty query", () => {
    for (const query of ["", "   "]) {
      expect(filterWikiEntries(titles, query, identity)).toBe(titles);
    }
  });

  it("ignores case and the query's surrounding space", () => {
    expect(filterWikiEntries(titles, "  LAUNCH  ", identity)).toEqual([
      "Alpha launch notes",
      "Beta launch plan",
    ]);
  });

  it("requires every word in the same title, in any order", () => {
    expect(filterWikiEntries(titles, "launch beta", identity)).toEqual([
      "Beta launch plan",
    ]);
    expect(filterWikiEntries(titles, "beta design", identity)).toEqual([]);
  });

  it("matches part of a word", () => {
    expect(filterWikiEntries(titles, "gam", identity)).toEqual([
      "Gamma design",
    ]);
  });

  it("keeps the entries in their original order", () => {
    expect(filterWikiEntries(titles, "launch", identity)).toEqual([
      "Alpha launch notes",
      "Beta launch plan",
    ]);
  });

  it("reads the title through the caller's projection", () => {
    const entries = [{ name: "Alpha" }, { name: "Beta", hidden: true }];
    expect(filterWikiEntries(entries, "beta", (entry) => entry.name)).toEqual([
      entries[1],
    ]);
  });
});

function identity(title: string) {
  return title;
}
