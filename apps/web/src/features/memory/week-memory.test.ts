import { describe, expect, it } from "vitest";

import { describeWeek, weekDays } from "./week-memory";

describe("week memory", () => {
  it("covers Monday through Sunday and names the fullest day", () => {
    expect(weekDays("2026-11-14")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    const days = weekDays("2026-11-14").map((date) => ({
      daily: date === "2026-11-12",
      date,
      meetings: date === "2026-11-12" ? 2 : date === "2026-11-14" ? 1 : 0,
      note: date === "2026-11-10",
    }));
    expect(describeWeek(days).summary).toBe(
      "You met 3 times. Thu, Nov 12 was the fullest, with 2 meetings. A daily was written on 1 day. You kept a note on 1 day.",
    );
    expect(describeWeek(days).lines).toContain(
      "Thu, Nov 12 · 2 meetings · a daily",
    );
  });
});
