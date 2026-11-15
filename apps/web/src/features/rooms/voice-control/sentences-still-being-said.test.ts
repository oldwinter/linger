import { describe, expect, it } from "vitest";

import { sentencesStillBeingSaid } from "./sentences-still-being-said";

describe("sentencesStillBeingSaid", () => {
  it("keeps a finished sentence while the rest is still being said", () => {
    expect(
      sentencesStillBeingSaid("We should ship it. And then we", []),
    ).toEqual({
      said: ["We should ship it."],
      saying: "And then we",
    });
  });

  it("does not say a sentence again once it is confirmed", () => {
    expect(
      sentencesStillBeingSaid("We should ship it. And then we", [
        { text: "We should ship it." },
      ]),
    ).toEqual({ said: [], saying: "And then we" });
  });

  it("leaves a sentence that has not finished as the words being said", () => {
    expect(sentencesStillBeingSaid("And then we", [])).toEqual({
      said: [],
      saying: "And then we",
    });
  });
});
