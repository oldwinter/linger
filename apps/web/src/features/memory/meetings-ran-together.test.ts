import { describe, expect, it } from "vitest";

import {
  meetingsRanTogether,
  meetingsRanTogetherText,
} from "./meetings-ran-together";

describe("meetings that ran together", () => {
  it("names the closest pair inside the underway window", () => {
    const overlap = meetingsRanTogether([
      { date: "2026-10-01", time: "09:05:00" },
      { date: "2026-10-01", time: "09:25:00" },
      { date: "2026-10-01", time: "17:41:02" },
    ]);
    expect(overlap).toEqual({
      earlier: "Meeting · Oct 1, 09:05",
      later: "Meeting · Oct 1, 09:25",
      minutesApart: 20,
    });
    expect(meetingsRanTogetherText(overlap!)).toBe(
      "Meeting · Oct 1, 09:25 began 20 minutes after Meeting · Oct 1, 09:05, while it was still underway.",
    );
  });

  it("stays quiet when the later meeting starts after the window", () => {
    expect(
      meetingsRanTogether([
        { date: "2026-10-01", time: "09:05:00" },
        { date: "2026-10-01", time: "17:41:02" },
      ]),
    ).toBeUndefined();
  });
});
