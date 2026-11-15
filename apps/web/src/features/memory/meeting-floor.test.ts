import { describe, expect, it } from "vitest";

import { floorSentence, meetingFloor } from "./meeting-floor";

const markdown = [
  "# Recording Transcript",
  "",
  "[00:00:00 - 00:10:00] Speaker 1 The long opening.",
  "",
  "[00:10:00 - 00:12:00] Speaker 2 A short reply.",
  "",
  "[00:20:00 - 00:22:00] Speaker 1 Back again.",
].join("\n");

describe("meetingFloor", () => {
  it("adds up who held the floor and the quiet between them", () => {
    const floor = meetingFloor(markdown);
    expect(floor?.shares).toEqual([
      { seconds: 12 * 60, speaker: "Speaker 1" },
      { seconds: 2 * 60, speaker: "Speaker 2" },
    ]);
    expect(floor?.quietSeconds).toBe(8 * 60);
    expect(floor?.span).toBe(22 * 60);
    expect(floorSentence(floor!)).toBe(
      "Speaker 1 spoke for 12 minutes. Speaker 2 spoke for 2 minutes. The room was quiet for 8 minutes.",
    );
  });

  it("stays hidden for one voice or a transcript without clocks", () => {
    expect(
      meetingFloor("[00:00:00 - 00:01:00] Speaker 1 Only me."),
    ).toBeUndefined();
    expect(
      meetingFloor("Speaker 1 Hello.\n\nSpeaker 2 There."),
    ).toBeUndefined();
  });
});
