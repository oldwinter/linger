import { describe, expect, it } from "vitest";

import { nameTranscriptSpeakers } from "./name-transcript";

const names = { spk_1: "Mina", spk_2: "Jonah" };

describe("nameTranscriptSpeakers", () => {
  it("replaces the turn label and leaves the spoken words", () => {
    const markdown = [
      "[00:00:01 - 00:00:02] Speaker 1: Ask Speaker 2 later.",
      "",
      "[00:00:02 - 00:00:03] Speaker 2 Sure.",
      "",
      "Speaker 3 was not named.",
    ].join("\n");
    expect(nameTranscriptSpeakers(markdown, names)).toBe(
      [
        "[00:00:01 - 00:00:02] Mina: Ask Speaker 2 later.",
        "",
        "[00:00:02 - 00:00:03] Jonah Sure.",
        "",
        "Speaker 3 was not named.",
      ].join("\n"),
    );
  });

  it("leaves the transcript alone when no voice has a name", () => {
    const markdown = "[00:00:01 - 00:00:02] Speaker 1 Hello.";
    expect(nameTranscriptSpeakers(markdown, {})).toBe(markdown);
  });
});
