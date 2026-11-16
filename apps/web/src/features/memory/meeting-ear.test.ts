import { describe, expect, it } from "vitest";

import { meetingEar } from "./meeting-ear";

describe("meetingEar", () => {
  it("starts in the left ear and ends in the right", () => {
    expect(meetingEar(0, 100)).toBe(-1);
    expect(meetingEar(50, 100)).toBe(0);
    expect(meetingEar(100, 100)).toBe(1);
    expect(meetingEar(150, 100)).toBe(1);
    expect(meetingEar(0, 0)).toBeUndefined();
    expect(meetingEar(Number.NaN, 10)).toBeUndefined();
  });
});
