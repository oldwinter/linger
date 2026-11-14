import { describe, expect, it } from "vitest";

import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { groupPocketNotesByMonth } from "./pocket-note-months";

function note(date: string): TeamHubPocketNote {
  return { date, text: `${date} page`, updated_at: `${date}T10:00:00Z` };
}

function dates(groups: ReturnType<typeof groupPocketNotesByMonth>): string[] {
  return groups.flatMap((group) => group.notes.map((item) => item.date));
}

describe("groupPocketNotesByMonth", () => {
  it("puts one month's notes under a single heading", () => {
    const groups = groupPocketNotesByMonth([
      note("2026-09-30"),
      note("2026-09-18"),
      note("2026-09-01"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "2026-09",
      label: "September 2026",
    });
    expect(dates(groups)).toEqual(["2026-09-30", "2026-09-18", "2026-09-01"]);
  });

  it("heads each month in the list's own order", () => {
    const groups = groupPocketNotesByMonth([
      note("2026-10-01"),
      note("2026-09-30"),
      note("2026-09-01"),
      note("2026-08-15"),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "October 2026",
      "September 2026",
      "August 2026",
    ]);
    expect(dates(groups)).toEqual([
      "2026-10-01",
      "2026-09-30",
      "2026-09-01",
      "2026-08-15",
    ]);
  });

  it("keeps unreadable dates in one trailing group", () => {
    const groups = groupPocketNotesByMonth([
      note("not-a-date"),
      note("2026-10-01"),
      note("2026-10-2"),
      note(""),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "October 2026",
      "Undated",
    ]);
    expect(dates(groups)).toEqual([
      "2026-10-01",
      "not-a-date",
      "2026-10-2",
      "",
    ]);
  });

  it("writes no headings for an empty list", () => {
    expect(groupPocketNotesByMonth([])).toEqual([]);
  });
});
