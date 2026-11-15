import { describe, expect, it } from "vitest";

import { retainWorkingSince, workingDuration } from "./working-duration";

const start = Date.parse("2026-11-14T10:00:00Z");

describe("working duration", () => {
  it("remembers when a Room started and forgets it when it stops", () => {
    const first = retainWorkingSince(["room-a"], {}, start);
    expect(first).toEqual({ "room-a": start });
    const later = retainWorkingSince(
      ["room-a", "room-b"],
      first,
      start + 5_000,
    );
    expect(later["room-a"]).toBe(start);
    expect(later["room-b"]).toBe(start + 5_000);
    expect(retainWorkingSince(["room-b"], later, start + 9_000)).toEqual({
      "room-b": start + 5_000,
    });
  });

  it("stays quiet for the first minute, then counts minutes, hours, and days", () => {
    expect(workingDuration(start, start + 59_000)).toBeUndefined();
    expect(workingDuration(start, start + 60_000)).toEqual({
      short: "1m",
      speech: "Agent working for 1 minute",
    });
    expect(workingDuration(start, start + 4 * 60_000)).toEqual({
      short: "4m",
      speech: "Agent working for 4 minutes",
    });
    expect(workingDuration(start, start + 60 * 60_000)).toEqual({
      short: "1h",
      speech: "Agent working for 1 hour",
    });
    expect(workingDuration(start, start + 125 * 60_000)).toEqual({
      short: "2h 5m",
      speech: "Agent working for 2 hours 5 minutes",
    });
    expect(workingDuration(start, start + 24 * 60 * 60_000)).toEqual({
      short: "1d",
      speech: "Agent working for 1 day",
    });
    expect(workingDuration(start, start - 1)).toBeUndefined();
    expect(workingDuration(undefined, start)).toBeUndefined();
  });
});
