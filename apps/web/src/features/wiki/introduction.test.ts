import { describe, expect, it } from "vitest";

import { seedProfile } from "@/test/teamhub-seed";

import {
  introductionLines,
  introductionNote,
  introductionParagraphs,
  noteWithIntroduction,
} from "./introduction";

describe("introduction", () => {
  it("leads with how you work and keeps an existing note", () => {
    const lines = introductionLines(seedProfile);
    const paragraphs = introductionParagraphs(lines, "work");
    expect(paragraphs[0]).toBe(
      "Jenny Bin works like this: Keeps execution close to customer outcomes.",
    );
    expect(paragraphs[1]).toBe("This is Jenny Bin.");
    const note = introductionNote(paragraphs);
    expect(noteWithIntroduction("Buy milk", note)).toBe(`Buy milk\n\n${note}`);
    expect(noteWithIntroduction(`Buy milk\n\n${note}`, note)).toBe(
      `Buy milk\n\n${note}`,
    );
  });
});
