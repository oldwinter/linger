import { describe, expect, it } from "vitest";

import { writingSeatText } from "./writing-seat";

describe("writingSeatText", () => {
  it("keeps the words that are still being written", () => {
    expect(writingSeatText("  Wait for Maya  ")).toBe("Wait for Maya");
  });

  it("leaves the seat empty when the composer has no words", () => {
    expect(writingSeatText(undefined)).toBeUndefined();
    expect(writingSeatText("  \n\t ")).toBeUndefined();
  });
});
