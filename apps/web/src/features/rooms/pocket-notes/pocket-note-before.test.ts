import { describe, expect, it } from "vitest";

import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { pocketNoteBefore } from "./pocket-note-before";

function note(date: string, text: string): TeamHubPocketNote {
  return { date, text, updated_at: `${date}T10:00:00Z` };
}

describe("pocketNoteBefore", () => {
  it("continues into the newest written day before today", () => {
    expect(
      pocketNoteBefore(
        [
          note("2026-10-02", "Tomorrow"),
          note("2026-10-01", "Today"),
          note("2026-09-30", ""),
          note("2026-09-28", "The day before"),
        ],
        "2026-10-01",
      )?.date,
    ).toBe("2026-09-28");
  });

  it("has nothing to continue into when no earlier page was written", () => {
    expect(
      pocketNoteBefore([note("2026-10-01", "Today")], "2026-10-01"),
    ).toBeUndefined();
  });
});
