import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import {
  featuredMemory,
  localCalendarDay,
  memoryRecallLabel,
  reportsBesideRecall,
  sameCalendarDay,
} from "./on-this-day";

function daily(
  day: string,
  updatedAt = `${day}T00:00:00Z`,
): TeamHubMemoryEntry {
  return {
    id: `daily-${day}-${updatedAt}`,
    kind: "daily",
    path: `timeline/daily/${day}.md`,
    date: day,
    title: `Daily ${day}`,
    summary: `Summary ${day}`,
    updated_at: updatedAt,
    content: "",
  };
}

function weekly(day: string): TeamHubMemoryEntry {
  return { ...daily(day), id: `weekly-${day}`, kind: "weekly" };
}

describe("on this day", () => {
  it("reads the viewer's calendar day", () => {
    expect(localCalendarDay(new Date(2026, 10, 14, 23, 30))).toBe("2026-11-14");
    expect(localCalendarDay(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("features the nearest earlier year on the same month and day", () => {
    const older = daily("2024-11-14");
    const nearer = daily("2025-11-14");
    const recall = featuredMemory(
      [daily("2026-11-14"), older, nearer, daily("2025-11-13")],
      "2026-11-14",
    );
    expect(recall).toMatchObject({
      day: "2025-11-14",
      yearsAgo: 1,
      entry: nearer,
    });
    expect(memoryRecallLabel(recall!)).toBe("A year ago");
  });

  it("names a farther year in years", () => {
    const recall = featuredMemory([daily("2022-03-01")], "2026-03-01");
    expect(recall?.yearsAgo).toBe(4);
    expect(memoryRecallLabel(recall!)).toBe("4 years ago");
  });

  it("keeps a leap day on leap days only", () => {
    expect(
      featuredMemory([daily("2020-02-29"), daily("2023-02-28")], "2024-02-29")
        ?.day,
    ).toBe("2020-02-29");
    expect(featuredMemory([daily("2024-02-29")], "2025-02-28")).toBeUndefined();
  });

  it("falls back to the Daily from seven days before", () => {
    const week = daily("2026-02-22");
    const recall = featuredMemory([daily("2026-03-01"), week], "2026-03-01");
    expect(recall).toEqual({ day: "2026-02-22", entry: week });
    expect(memoryRecallLabel(recall!)).toBe("A week ago");
  });

  it("prefers a year match over the week before", () => {
    const recall = featuredMemory(
      [daily("2025-11-14"), daily("2026-11-07")],
      "2026-11-14",
    );
    expect(recall?.yearsAgo).toBe(1);
  });

  it("ignores weekly reports, invalid days, and a later year", () => {
    expect(
      featuredMemory([weekly("2025-11-10")], "2026-11-14"),
    ).toBeUndefined();
    expect(featuredMemory([daily("2025-11-14")], "2026-02-31")).toBeUndefined();
    expect(sameCalendarDay([daily("2027-11-14")], "2026-11-14")).toEqual([
      expect.objectContaining({ day: "2027-11-14", yearsAgo: -1 }),
    ]);
  });

  it("keeps the later write when one day has two Dailies", () => {
    const first = daily("2025-11-14", "2025-11-14T01:00:00Z");
    const second = daily("2025-11-14", "2025-11-14T18:00:00Z");
    expect(featuredMemory([first, second], "2026-11-14")?.entry).toBe(second);
  });

  it("lists other years nearest first, both directions", () => {
    expect(
      sameCalendarDay(
        [daily("2024-11-14"), daily("2025-11-14"), daily("2027-11-14")],
        "2026-11-14",
      ).map((item) => item.day),
    ).toEqual(["2025-11-14", "2027-11-14", "2024-11-14"]);
  });

  it("does not list the featured memory among the recent reports", () => {
    const year = daily("2025-11-14");
    const today = daily("2026-11-14");
    const yesterday = daily("2026-11-13");
    const entries = [today, yesterday, year];
    const recall = featuredMemory(entries, "2026-11-14");
    expect(
      reportsBesideRecall(entries, recall, 2).map((entry) => entry.date),
    ).toEqual(["2026-11-14", "2026-11-13"]);
    expect(reportsBesideRecall(entries, undefined, 2)).toHaveLength(2);
  });
});
