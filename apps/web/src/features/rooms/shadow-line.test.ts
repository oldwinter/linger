import { describe, expect, it } from "vitest";

import { latestShadowLine } from "./shadow-line";

const now = Date.parse("2026-11-14T12:00:00Z");

describe("latest shadow line", () => {
  it("names the newest difference from the last two weeks", () => {
    expect(
      latestShadowLine(
        [
          {
            created_at: "2026-11-13T08:00:00Z",
            matter: "AWS invoice",
            shadow_action: "track",
            taken_action: "notify",
          },
          {
            created_at: "2026-11-01T08:00:00Z",
            matter: "Older",
            shadow_action: "silent",
            taken_action: "notify",
          },
        ],
        now,
      ),
    ).toBe(
      "AWS invoice: a shadow rule would follow up later; Another Me chose to tell now",
    );
  });

  it("hides a difference older than two weeks, a future one, or none", () => {
    expect(
      latestShadowLine(
        [
          {
            created_at: "2026-10-01T08:00:00Z",
            matter: "Old",
            shadow_action: "silent",
            taken_action: "notify",
          },
        ],
        now,
      ),
    ).toBeUndefined();
    expect(
      latestShadowLine(
        [
          {
            created_at: "2026-11-15T08:00:00Z",
            matter: "Future",
            shadow_action: "silent",
            taken_action: "notify",
          },
        ],
        now,
      ),
    ).toBeUndefined();
    expect(latestShadowLine([], now)).toBeUndefined();
  });
});
