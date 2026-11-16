import { describe, expect, it } from "vitest";

import { meetingPace, paceAt } from "./meeting-pace";

function turn(start: string, end: string, words: string) {
  return `[${start} - ${end}] Speaker 1 ${words}`;
}

const rushed = "one two three four five six seven eight nine ten";
const sparse = "one two";

describe("meetingPace", () => {
  it("slows a rush and speeds a sparse stretch", () => {
    const points = meetingPace(
      [
        turn("00:00:00", "00:00:10", sparse),
        turn("00:00:10", "00:00:12", rushed),
        turn("00:00:12", "00:00:22", sparse),
        turn("00:00:22", "00:00:24", rushed),
      ].join("\n\n"),
    );
    expect(points?.map((point) => point.rate)).toEqual([2, 0.75, 2, 0.75]);
    expect(paceAt(points ?? [], 0)).toBe(2);
    expect(paceAt(points ?? [], 11)).toBe(0.75);
    expect(paceAt(points ?? [], 23)).toBe(0.75);
  });

  it("is absent when the turns share one pace or there are too few", () => {
    expect(
      meetingPace(
        [
          turn("00:00:00", "00:00:10", sparse),
          turn("00:00:10", "00:00:20", sparse),
          turn("00:00:20", "00:00:30", sparse),
          turn("00:00:30", "00:00:40", sparse),
        ].join("\n\n"),
      ),
    ).toBeUndefined();
    expect(
      meetingPace(
        [
          turn("00:00:00", "00:00:10", sparse),
          turn("00:00:10", "00:00:12", rushed),
        ].join("\n\n"),
      ),
    ).toBeUndefined();
  });
});
