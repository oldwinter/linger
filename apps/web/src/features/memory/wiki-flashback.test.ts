import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { flashbackReport } from "./wiki-flashback";

function report(day: string, id = `daily-${day}`): TeamHubMemoryEntry {
  return {
    id,
    kind: "daily",
    path: `timeline/daily/${day}.md`,
    date: day,
    title: `Daily ${day}`,
    summary: "",
    updated_at: `${day}T00:00:00Z`,
    content: "",
  };
}

describe("flashbackReport", () => {
  it("chooses the same day one month earlier over the year-ago one", () => {
    const chosen = flashbackReport(
      [report("2026-10-15"), report("2025-11-15")],
      "2026-11-15",
    );

    expect(chosen).toMatchObject({ label: "One month ago", day: "2026-10-15" });
    expect(chosen?.entry.id).toBe("daily-2026-10-15");
  });

  it.each([
    ["2026-03-31", "2026-02-28"],
    ["2026-05-31", "2026-04-30"],
    ["2024-03-31", "2024-02-29"],
  ])("clamps %s to the shorter month's last day", (reference, day) => {
    const chosen = flashbackReport([report(day)], reference);

    expect(chosen).toMatchObject({ label: "One month ago", day });
  });

  it("falls back to the same day one year earlier", () => {
    const chosen = flashbackReport([report("2025-11-15")], "2026-11-15");

    expect(chosen).toMatchObject({ label: "One year ago", day: "2025-11-15" });
  });

  it("returns nothing when neither day has a Daily report", () => {
    expect(
      flashbackReport([report("2026-11-01")], "2026-11-15"),
    ).toBeUndefined();
    expect(flashbackReport([], "2026-11-15")).toBeUndefined();
    expect(flashbackReport(undefined, "2026-11-15")).toBeUndefined();
  });

  it("uses the first report when several share the chosen date", () => {
    const chosen = flashbackReport(
      [report("2026-10-15", "first"), report("2026-10-15", "second")],
      "2026-11-15",
    );

    expect(chosen?.entry.id).toBe("first");
  });
});
