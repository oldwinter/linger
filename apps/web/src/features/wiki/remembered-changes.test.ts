import { describe, expect, it } from "vitest";

import { seedProfile } from "@/test/teamhub-seed";

import {
  memoryChanges,
  previousRememberedRevision,
} from "./remembered-changes";

describe("memoryChanges", () => {
  it("names an overview that changed and a point that was added", () => {
    const current = structuredClone(seedProfile);
    current.communication_style.overview = "Short questions, then a decision.";
    current.working_style.points.push({
      title: "Focus",
      text: "One thread at a time.",
      items: [],
    });
    const changes = memoryChanges(current, seedProfile);
    expect(changes).toEqual([
      expect.objectContaining({
        section: "Communication style",
        kind: "changed",
        label: "Overview",
        before: "Direct and written-first.",
        after: "Short questions, then a decision.",
      }),
      expect.objectContaining({
        section: "Working style",
        kind: "added",
        label: "Focus",
        after: "One thread at a time.",
      }),
    ]);
  });

  it("treats a missing previous revision as the whole profile being new", () => {
    const changes = memoryChanges(seedProfile);
    expect(changes.some((change) => change.label === "Name")).toBe(true);
    expect(
      previousRememberedRevision({
        current: revision("current"),
        history: [revision("current"), revision("older")],
      })?.id,
    ).toBe("older");
  });
});

function revision(id: string) {
  return {
    created_at: "2026-08-11T08:00:00.000Z",
    id,
    markdown: "",
    profile: seedProfile,
    prompt_version: "user-profile-v1",
    tenant_id: "tenant-northstar",
  };
}
