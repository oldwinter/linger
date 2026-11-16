import { describe, expect, it } from "vitest";

import {
  copiedMeetingLine,
  copiedMeetingLineText,
  meetingCopiedLines,
  meetingLineOpenUrl,
} from "./meeting-copied-line";

const transcript = `[00:02:52 - 00:03:09] Speaker 2: This part needs breathing room.

[00:03:09 - 00:03:15] Look, it blinks.
`;

describe("meetingCopiedLines", () => {
  it("keeps who said a line and where the recording was", () => {
    expect(meetingCopiedLines(transcript)).toEqual([
      {
        speaker: "Speaker 2",
        startLabel: "00:02:52",
        startSeconds: 172,
        text: "This part needs breathing room.",
      },
      {
        startLabel: "00:03:09",
        startSeconds: 189,
        text: "Look, it blinks.",
      },
    ]);
  });
});

describe("copiedMeetingLine", () => {
  const lines = meetingCopiedLines(transcript);

  it("copies one line with its speaker, its moment, and a way back", () => {
    const line = copiedMeetingLine(lines, "breathing room");
    expect(line?.speaker).toBe("Speaker 2");
    expect(
      copiedMeetingLineText(
        line!,
        meetingLineOpenUrl(
          "http://meetings.invalid/t/tenant/library/meetings?entry=meeting-1",
          line!.startSeconds,
        ),
      ),
    ).toBe(
      "Speaker 2, 00:02:52\nThis part needs breathing room.\n/t/tenant/library/meetings?entry=meeting-1&file=summary&at=172",
    );
  });

  it("leaves a selection that spans two lines", () => {
    expect(
      copiedMeetingLine(lines, "breathing room. Look, it blinks."),
    ).toBeUndefined();
  });
});
