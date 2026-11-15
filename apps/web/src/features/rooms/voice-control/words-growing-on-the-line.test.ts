import { describe, expect, it } from "vitest";

import { wordsGrowingOnTheLine } from "./words-growing-on-the-line";

describe("wordsGrowingOnTheLine", () => {
  it("grows the words that continue the last line", () => {
    expect(
      wordsGrowingOnTheLine("We should ship it. And then we", {
        text: "We should ship it.",
      }),
    ).toEqual({ growing: "And then we" });
  });

  it("keeps a sentence that does not continue the last line on its own", () => {
    expect(
      wordsGrowingOnTheLine("Please confirm this schedule", {
        text: "Please confirm this schedule",
      }),
    ).toEqual({ aside: "Please confirm this schedule" });
    expect(
      wordsGrowingOnTheLine("Recognizing this sentence live", {
        text: "Confirmed live transcript",
      }),
    ).toEqual({ aside: "Recognizing this sentence live" });
  });
});
