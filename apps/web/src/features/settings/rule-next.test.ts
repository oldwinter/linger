import { describe, expect, it } from "vitest";

import { nextTimeChange } from "./rule-next";

describe("nextTimeChange", () => {
  it("says what Another Me did and what the rule will do next", () => {
    expect(
      nextTimeChange({
        matter: "AWS invoice",
        shadow_action: "track",
        taken_action: "notify",
      }),
    ).toBe(
      "On AWS invoice, Another Me chose to tell you now. From the next time this rule decides, it will follow up later.",
    );
  });
});
