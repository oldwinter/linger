import { describe, expect, it } from "vitest";

import { msUntilLocalMidnight } from "./local-calendar-day";

describe("msUntilLocalMidnight", () => {
  it("waits until the next local midnight", () => {
    expect(msUntilLocalMidnight(new Date(2026, 9, 1, 16, 0, 0))).toBe(
      8 * 60 * 60 * 1000,
    );
    expect(msUntilLocalMidnight(new Date(2026, 9, 1, 23, 59, 50))).toBe(10_000);
    expect(msUntilLocalMidnight(new Date(2026, 9, 2, 0, 0, 0))).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
