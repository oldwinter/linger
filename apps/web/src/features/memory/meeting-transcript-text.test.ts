import { describe, expect, it } from "vitest";

import {
  meetingSpeakerPart,
  meetingSpeakerPartText,
  meetingSpeakers,
  meetingTranscriptText,
  meetingTranscriptTurns,
} from "./meeting-transcript-text";

describe("meetingTranscriptText", () => {
  it("exposes the turns the text joins", () => {
    const markdown = [
      "# Recording Transcript — September 10, 2026 at 06:45 UTC",
      "",
      "> The recording lost a second of audio.",
      "",
      "[00:00:01 - 00:00:02] Speaker 1 First sentence.",
      "",
      "[00:00:02 - 00:00:03] Second sentence.",
    ].join("\n");

    expect(meetingTranscriptTurns(markdown)).toEqual([
      "Speaker 1: First sentence.",
      "Second sentence.",
    ]);
    expect(meetingTranscriptText(markdown)).toBe(
      meetingTranscriptTurns(markdown).join("\n"),
    );
  });

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

describe("meetingSpeakerPart", () => {
  const markdown = [
    "# Recording Transcript",
    "",
    "[00:00:10 - 00:00:20] Speaker 1 First.",
    "",
    "[00:00:20 - 00:00:40] Speaker 2 Meanwhile.",
    "",
    "[00:04:40 - 00:05:00] Speaker 1 Again.",
    "",
    "[00:05:10 - 00:05:20] Speaker 1 Still here.",
    "",
    "[02:05:20 - 02:06:00] Speaker 1 Much later.",
  ].join("\n");

  it("names the minutes before a speaker talks again", () => {
    expect(meetingSpeakers(markdown)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(meetingSpeakerPart(markdown, "Speaker 1")).toEqual([
      { kind: "said", text: "First." },
      { kind: "passed", text: "4 minutes passed" },
      { kind: "said", text: "Again." },
      { kind: "said", text: "Still here." },
      { kind: "passed", text: "2 hours passed" },
      { kind: "said", text: "Much later." },
    ]);
    expect(
      meetingSpeakerPartText(meetingSpeakerPart(markdown, "Speaker 1")),
    ).toBe(
      [
        "First.",
        "4 minutes passed",
        "Again.",
        "Still here.",
        "2 hours passed",
        "Much later.",
      ].join("\n\n"),
    );
  });

  it("leaves a one-voice meeting as that voice, with no invented wait", () => {
    const alone = "[00:00:01 - 00:00:02] Speaker 1 Only me.";
    expect(meetingSpeakers(alone)).toEqual(["Speaker 1"]);
    expect(meetingSpeakerPart(alone, "Speaker 1")).toEqual([
      { kind: "said", text: "Only me." },
    ]);
    expect(meetingSpeakerPart(markdown, "Speaker 3")).toEqual([]);
  });
});
