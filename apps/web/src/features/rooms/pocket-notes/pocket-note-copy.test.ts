import { describe, expect, it } from "vitest";

import { pocketNoteCopyText } from "./pocket-note-copy";

describe("pocketNoteCopyText", () => {
  it("keeps the text as written and closes it with one newline", () => {
    expect(pocketNoteCopyText("Buy milk\nCall the dentist")).toBe(
      "Buy milk\nCall the dentist\n",
    );
  });

  it("keeps the Markdown markers the page shows", () => {
    expect(pocketNoteCopyText("# Plan\n\n- one")).toBe("# Plan\n\n- one\n");
  });

  it("reduces trailing whitespace to one closing newline", () => {
    expect(pocketNoteCopyText("Buy milk\n\n\n")).toBe("Buy milk\n");
    expect(pocketNoteCopyText("Buy milk   \n \n")).toBe("Buy milk\n");
    expect(pocketNoteCopyText("Buy milk   ")).toBe("Buy milk\n");
  });

  it("is empty when the page holds nothing", () => {
    expect(pocketNoteCopyText("")).toBe("");
    expect(pocketNoteCopyText("  \n\t")).toBe("");
  });
});
