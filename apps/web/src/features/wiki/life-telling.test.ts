import { describe, expect, it } from "vitest";

import type { TeamHubPersonalProfileTimelineEntry } from "@/features/teamhub/teamhub-types";

import { lifeChapters } from "./life-telling";

function entry(
  period: string,
  organization: string,
  extra: Partial<TeamHubPersonalProfileTimelineEntry> = {},
): TeamHubPersonalProfileTimelineEntry {
  return {
    description: "",
    details: [],
    organization,
    period,
    place: "",
    role: "",
    ...extra,
  };
}

describe("lifeChapters", () => {
  it("tells the earliest year first, as a sentence someone could say", () => {
    expect(
      lifeChapters([
        entry("2019–2022", "Northstar", {
          description: "Shipped the notes.",
          place: "Lisbon",
          role: "Designer",
        }),
        entry("–2014", "School", { role: "Student" }),
        entry("2014", "Studio", { details: ["Drew the first mark."] }),
      ]).map((chapter) => `${chapter.period}. ${chapter.sentence}`),
    ).toEqual([
      "–2014. Student at School",
      "2014. Studio. Drew the first mark.",
      "2019–2022. Designer at Northstar, Lisbon. Shipped the notes.",
    ]);
  });

  it("keeps an undated chapter after the dated ones", () => {
    expect(
      lifeChapters([
        entry("Present", "Now", { role: "Builder" }),
        entry("2010", "Then"),
      ]).map((chapter) => chapter.period),
    ).toEqual(["2010", "Present"]);
  });
});
