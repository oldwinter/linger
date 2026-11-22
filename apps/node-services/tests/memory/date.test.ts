import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertDateString,
  localDate,
  localDateWindow,
  localTimeZone,
  previousDate,
} from "../../src/memory/date.js";
import { parseOptions } from "../../src/memory/options.js";

describe("Memory business days", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "2026-02-29",
    "2026-02-30",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
  ])(
    "rejects impossible calendar dates before selecting a collection window: %s",
    (date) => {
      expect(() => assertDateString(date)).toThrow(/date/i);
      expect(() => parseOptions(["--date", date])).toThrow(/date/i);
      expect(() => parseOptions(["--week-start", date])).toThrow(/date/i);
      expect(() => localDateWindow(date)).toThrow(/date/i);
      expect(() => previousDate(date)).toThrow(/date/i);
    },
  );

  it.each([
    ["2024-02-29", "2024-02-28"],
    ["2000-02-29", "2000-02-28"],
    ["1900-03-01", "1900-02-28"],
    ["2026-01-01", "2025-12-31"],
  ])("keeps valid calendar boundaries for %s", (date, previous) => {
    expect(assertDateString(date)).toBe(date);
    expect(parseOptions(["--date", date, "--week-start", date])).toMatchObject({
      date,
      weekStart: date,
    });
    expect(previousDate(date)).toBe(previous);
  });

  it("puts the Daily window on the process zone's midnights, DST included", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(localTimeZone()).toBe("America/New_York");
    expect(localDateWindow("2026-09-15")).toEqual({
      startIso: "2026-09-15T04:00:00.000Z",
      endIso: "2026-09-16T04:00:00.000Z",
    });
    // The day daylight saving time ends lasts 25 hours, the day it starts 23.
    expect(localDateWindow("2026-11-01")).toEqual({
      startIso: "2026-11-01T04:00:00.000Z",
      endIso: "2026-11-02T05:00:00.000Z",
    });
    expect(localDateWindow("2026-03-08")).toEqual({
      startIso: "2026-03-08T05:00:00.000Z",
      endIso: "2026-03-09T04:00:00.000Z",
    });
  });

  it("dates an instant by the process zone", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(localDate(new Date("2026-09-16T03:59:59Z"))).toBe("2026-09-15");
    expect(localDate("2026-09-16T04:00:00Z")).toBe("2026-09-16");
    vi.stubEnv("TZ", "Asia/Shanghai");
    expect(localDate("2026-09-15T16:00:00Z")).toBe("2026-09-16");
  });
});
