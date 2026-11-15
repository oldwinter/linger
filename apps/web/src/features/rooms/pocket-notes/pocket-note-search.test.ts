import { describe, expect, it } from "vitest";

import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { searchPocketNotes } from "./pocket-note-search";

function note(date: string, text: string): TeamHubPocketNote {
  return { date, text, updated_at: `${date}T10:00:00Z` };
}

const notes = [
  note("2026-10-01", "Shipped the **graph** preview"),
  note("2026-09-30", "Reviewed the flashback card"),
];

const dates = (query: string) =>
  searchPocketNotes(notes, query).items.map((item) => item.date);

describe("searchPocketNotes", () => {
  it("keeps every loaded note for an empty or whitespace query", () => {
    expect(dates("")).toEqual(["2026-10-01", "2026-09-30"]);
    expect(dates("  \n ")).toEqual(["2026-10-01", "2026-09-30"]);
    expect(searchPocketNotes(notes, "").matched).toBe(true);
  });

  it("matches a word in the readable text", () => {
    expect(dates("flashback")).toEqual(["2026-09-30"]);
  });

  it("matches a word in the note date", () => {
    expect(dates("2026-09-30")).toEqual(["2026-09-30"]);
  });

  it("requires every word to match the same note", () => {
    expect(dates("reviewed flashback")).toEqual(["2026-09-30"]);
    expect(dates("2026-09-30 reviewed")).toEqual(["2026-09-30"]);
    expect(dates("shipped flashback")).toEqual([]);
  });

  it("ignores case", () => {
    expect(dates("REVIEWED Flashback")).toEqual(["2026-09-30"]);
  });

  it("reports no match when no note holds the words", () => {
    expect(searchPocketNotes(notes, "nonexistent")).toEqual({
      items: [],
      matched: false,
    });
  });

  it("searches readable text without Markdown markers", () => {
    expect(dates("graph")).toEqual(["2026-10-01"]);
    expect(dates("**")).toEqual([]);
  });
});
