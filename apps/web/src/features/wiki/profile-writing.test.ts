import { describe, expect, it } from "vitest";

import type {
  TeamHubPersonalProfileDocument,
  TeamHubPersonalProfileModule,
} from "@/features/teamhub/teamhub-types";

import { profileSectionBeingWritten } from "./profile-writing";

function module(overview = ""): TeamHubPersonalProfileModule {
  return { overview, points: [] };
}

function profile(
  extra: Partial<TeamHubPersonalProfileDocument> = {},
): TeamHubPersonalProfileDocument {
  return {
    name: "Jenny",
    background: { overview: "", points: [], timeline: [] },
    communication_style: module(),
    working_style: module(),
    preferences: module(),
    writing_style: module(),
    ...extra,
  };
}

describe("profileSectionBeingWritten", () => {
  it("follows the furthest section that gained words", () => {
    const earlier = profile({
      background: {
        overview: "A designer.",
        points: [],
        timeline: [],
      },
    });
    const later = profile({
      background: earlier.background,
      communication_style: module("Writes short lines."),
      working_style: module("Starts with the notes."),
    });
    expect(profileSectionBeingWritten(earlier, later)).toBe("Working style");
    expect(profileSectionBeingWritten(later, later)).toBeUndefined();
  });

  it("starts at the last section that already has words", () => {
    expect(
      profileSectionBeingWritten(
        undefined,
        profile({
          background: { overview: "A designer.", points: [], timeline: [] },
          communication_style: module("Writes short lines."),
        }),
      ),
    ).toBe("Communication style");
  });
});
