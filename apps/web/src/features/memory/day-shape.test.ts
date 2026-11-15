import { describe, expect, it } from "vitest";

import { dayShape, openStretchPhrase, shiftDay } from "./day-shape";

describe("dayShape", () => {
  it("names the longest open stretch between meetings", () => {
    const shape = dayShape([
      { id: "afternoon", time: "17:41:02" },
      { id: "morning", time: "09:05:00" },
    ]);
    expect(shape.summary).toBe(
      "2 meetings. The longest open stretch is 8 hours 36 min, from 09:05 to 17:41.",
    );
    expect(shape.segments.map((segment) => segment.kind)).toEqual([
      "open",
      "meeting",
      "open",
      "meeting",
      "open",
    ]);
    expect(openStretchPhrase(60)).toBe("1 hour open");
  });

  it("calls a day with no meetings open, and a packed day filled in", () => {
    expect(dayShape([]).summary).toBe("The day is open.");
    expect(
      dayShape([
        { id: "one", time: "10:00:00" },
        { id: "two", time: "10:20:00" },
      ]).summary,
    ).toBe("2 meetings. They sit close together.");
    expect(dayShape([{ id: "only", time: "11:00:00" }]).summary).toBe(
      "One meeting, at 11:00. The rest of the day is open.",
    );
  });

  it("shifts a calendar day without changing the month math", () => {
    expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
  });
});
