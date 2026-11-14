import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { reportSearchItems, searchReports } from "./report-search";

function report(day: string, content: string): TeamHubMemoryEntry {
  return {
    id: day,
    kind: "daily",
    path: `timeline/daily/${day}.md`,
    date: day,
    title: `Daily ${day}`,
    summary: "",
    updated_at: `${day}T00:00:00Z`,
    content: `---\nformatter: internal-only\ndate: ${day}\n---\n${content}`,
  };
}

const items = reportSearchItems([
  report("2026-10-14", "## Work\n\nShipped the graph preview.\n"),
  report("2026-10-15", "## Work\n\nReviewed the flashback card.\n"),
]);

const days = (query: string) =>
  searchReports(items, query).map((item) => item.day);

describe("searchReports", () => {
  it("keeps every report for an empty or whitespace query", () => {
    expect(searchReports(items, "")).toEqual(items);
    expect(days("  \n ")).toEqual(["2026-10-14", "2026-10-15"]);
  });

  it("matches a word in the report date", () => {
    expect(days("2026-10-14")).toEqual(["2026-10-14"]);
  });

  it("matches a word in the readable text", () => {
    expect(days("flashback")).toEqual(["2026-10-15"]);
  });

  it("requires every word to match the same report", () => {
    expect(days("reviewed flashback")).toEqual(["2026-10-15"]);
    expect(days("2026-10-15 reviewed")).toEqual(["2026-10-15"]);
    expect(days("shipped flashback")).toEqual([]);
  });

  it("ignores case", () => {
    expect(days("REVIEWED Flashback")).toEqual(["2026-10-15"]);
  });

  it("matches nothing when no report holds the words", () => {
    expect(days("nonexistent")).toEqual([]);
  });
});
