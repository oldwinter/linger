import { describe, expect, it } from "vitest";

import { pdfPageCopyText } from "./pdf-page-text";

describe("pdfPageCopyText", () => {
  it("drops the null between glyphs and keeps the sentence", () => {
    expect(pdfPageCopyText("The launch\0 slipped.")).toBe("The launch slipped.");
  });

  it("turns a compatibility space into an ordinary one", () => {
    expect(pdfPageCopyText("A\u00a0line")).toBe("A line");
  });
});
