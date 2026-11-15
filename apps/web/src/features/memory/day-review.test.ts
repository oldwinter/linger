import { describe, expect, it } from "vitest";

import { isCalendarDay, reviewDay, shiftDay } from "./day-review";

describe("day review", () => {
  it("rejects dates that are not a real day", () => {
    expect(isCalendarDay("2026-11-14")).toBe(true);
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(isCalendarDay("14 Nov")).toBe(false);
    expect(isCalendarDay(null)).toBe(false);
  });

  it("steps across month boundaries", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("keeps a past day and pulls a future day back to today", () => {
    expect(reviewDay("2026-11-13", "2026-11-14")).toBe("2026-11-13");
    expect(reviewDay("2026-11-14", "2026-11-14")).toBe("2026-11-14");
    expect(reviewDay("2026-11-20", "2026-11-14")).toBe("2026-11-14");
    expect(reviewDay("nope", "2026-11-14")).toBe("2026-11-14");
    expect(reviewDay(null, undefined)).toBeUndefined();
    expect(reviewDay("2026-11-02", undefined)).toBe("2026-11-02");
  });
});
