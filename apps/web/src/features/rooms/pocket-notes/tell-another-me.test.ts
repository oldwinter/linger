import { describe, expect, it } from "vitest";

import { pocketTellMessage } from "./tell-another-me";

describe("pocket tell message", () => {
  it("carries the trimmed note under a fixed heading", () => {
    expect(pocketTellMessage("  Buy milk\nCall Mom  ")).toBe(
      "From today's Pocket note:\n\nBuy milk\nCall Mom",
    );
  });
});
