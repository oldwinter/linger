import { describe, expect, it } from "vitest";

import { timedTranscriptTurns, wordsInTopic } from "./topic-words";

const transcript = [
  "# Kickoff",
  "",
  "[00:00:10 - 00:00:40] Speaker 1 We should ship Friday.",
  "",
  "[00:01:10 - 00:02:00] Speaker 2 The note can wait.",
  "",
  "[00:04:00 - 00:04:20] Speaker 1 After the topic.",
].join("\n");

describe("wordsInTopic", () => {
  it("keeps the lines that begin inside the topic", () => {
    const turns = timedTranscriptTurns(transcript);
    expect(wordsInTopic(turns, "00:00:00 – 00:03:00")).toEqual([
      "Speaker 1 We should ship Friday.",
      "Speaker 2 The note can wait.",
    ]);
  });

  it("returns nothing when the topic has no clock", () => {
    expect(wordsInTopic(timedTranscriptTurns(transcript), "later")).toEqual([]);
  });
});
