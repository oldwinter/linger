import { describe, expect, it } from "vitest";

import { meetingTranscriptText } from "./meeting-transcript-text";

describe("meetingTranscriptText", () => {
  it("writes one Speaker line per turn in spoken order", () => {
    const markdown = [
      "# Recording Transcript — September 10, 2026 at 06:45 UTC",
      "",
      "> This recording contains 1 unrecoverable interruption(s), totaling 00:00:03 of missing audio. Timestamps below are compressed to the available audio.",
      "",
      "[00:00:01 - 00:00:02] Speaker 1 First sentence.",
      "",
      "[00:00:02 - 00:00:03] Speaker 2 Second sentence.",
      "",
      "[Recognized during missing audio] Speaker 1 Third sentence.",
    ].join("\n");

    expect(meetingTranscriptText(markdown)).toBe(
      [
        "Speaker 1: First sentence.",
        "Speaker 2: Second sentence.",
        "Speaker 1: Third sentence.",
      ].join("\n"),
    );
  });

  it("keeps a turn that has no speaker label as its text alone", () => {
    const markdown =
      "[00:02:52 - 00:03:09] Sure, then follow this format.\n\n[00:03:09 - 00:03:15] Look, it blinks.";

    expect(meetingTranscriptText(markdown)).toBe(
      "Sure, then follow this format.\nLook, it blinks.",
    );
  });

  it("drops turns whose text is empty", () => {
    const markdown = [
      "[00:00:01 - 00:00:02] Speaker 1",
      "[00:00:02 - 00:00:03]",
      "[00:00:03 - 00:00:04] Speaker 2 Kept.",
      "[00:00:04 - 00:00:05] Speaker 1   ",
    ].join("\n\n");

    expect(meetingTranscriptText(markdown)).toBe("Speaker 2: Kept.");
  });

  it("strips the Markdown markers around a speaker label and its text", () => {
    const markdown =
      "**Speaker 1:** *Hello* there, use the `ping` command.\n\n- **Speaker 2:** [Second](https://example.com) point.";

    expect(meetingTranscriptText(markdown)).toBe(
      "Speaker 1: Hello there, use the ping command.\nSpeaker 2: Second point.",
    );
  });

  it("joins a turn that wrapped across source lines into one line", () => {
    const markdown = "Speaker 1: A sentence that\nwrapped in the source.";

    expect(meetingTranscriptText(markdown)).toBe(
      "Speaker 1: A sentence that wrapped in the source.",
    );
  });

  it("produces nothing for an empty transcript", () => {
    expect(meetingTranscriptText("")).toBe("");
    expect(meetingTranscriptText("# Recording Transcript\n\n")).toBe("");
  });
});
