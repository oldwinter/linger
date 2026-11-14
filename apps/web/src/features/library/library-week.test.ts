import { describe, expect, it } from "vitest";

import { describeLibraryWeek, weekDates } from "./library-week";

describe("library week", () => {
  it("names the busiest day in a Monday-through-Sunday week", () => {
    expect(weekDates("2026-11-14")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    const picture = describeLibraryWeek([
      {
        date: "2026-11-12",
        id: "notes",
        owner: "Jenny Bin",
        title: "Standup notes.md",
      },
      {
        date: "2026-11-12",
        id: "brief",
        owner: "Jenny Bin",
        title: "Launch brief.md",
      },
      {
        date: "2026-11-10",
        id: "old-week",
        owner: "Maya Chen",
        title: "Agenda.md",
      },
    ]);
    expect(picture.summary).toBe(
      "3 files changed. Thu, Nov 12 held the most, with 2.",
    );
    expect(picture.days.map((day) => day.label)).toEqual([
      "Thu, Nov 12",
      "Tue, Nov 10",
    ]);
    expect(picture.days[0]?.files.map((file) => file.title)).toEqual([
      "Launch brief.md",
      "Standup notes.md",
    ]);
  });

  it("says when the library was quiet", () => {
    expect(describeLibraryWeek([]).summary).toBe(
      "The library was quiet this week.",
    );
  });
});
