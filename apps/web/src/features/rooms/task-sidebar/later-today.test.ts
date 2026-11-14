import { describe, expect, it } from "vitest";

import { laterTodayRunAt } from "./later-today";

describe("later today", () => {
  const now = new Date(2026, 10, 14, 10, 0, 0);

  it("pushes a reminder that is still today three hours past its time", () => {
    const later = laterTodayRunAt(
      now,
      new Date(2026, 10, 14, 11, 0, 0).toISOString(),
    );
    expect(later?.toISOString()).toBe(
      new Date(2026, 10, 14, 14, 0, 0).toISOString(),
    );
  });

  it("holds an overdue reminder from now, and refuses one that would land tomorrow", () => {
    expect(
      laterTodayRunAt(
        now,
        new Date(2026, 10, 14, 8, 0, 0).toISOString(),
      )?.toISOString(),
    ).toBe(new Date(2026, 10, 14, 13, 0, 0).toISOString());
    expect(
      laterTodayRunAt(now, new Date(2026, 10, 14, 22, 0, 0).toISOString()),
    ).toBeUndefined();
    expect(
      laterTodayRunAt(now, new Date(2026, 10, 15, 9, 0, 0).toISOString()),
    ).toBeUndefined();
  });
});
