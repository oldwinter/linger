import { describe, expect, it } from "vitest";

import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { pocketNotesMarkdown } from "./pocket-notes-export";

function note(date: string, text: string): TeamHubPocketNote {
  return { date, text, updated_at: `${date}T10:00:00Z` };
}

describe("pocketNotesMarkdown", () => {
  it("writes every page newest first under its own date heading", () => {
    const markdown = pocketNotesMarkdown([
      note("2026-10-01", "First note"),
      note("2026-09-30", "Yesterday's idea"),
      note("2026-09-01", "Older idea"),
    ]);

    expect(markdown).toBe(
      [
        "# Pocket Notes",
        "## 2026-10-01",
        "First note",
        "## 2026-09-30",
        "Yesterday's idea",
        "## 2026-09-01",
        "Older idea",
      ].join("\n\n"),
    );
    expect(markdown.endsWith("Older idea")).toBe(true);
  });

  it("skips a page with nothing written on it", () => {
    const markdown = pocketNotesMarkdown([
      note("2026-10-01", "First note"),
      note("2026-09-30", "   \n  "),
      note("2026-09-01", "Older idea"),
    ]);

    expect(markdown).toBe(
      [
        "# Pocket Notes",
        "## 2026-10-01",
        "First note",
        "## 2026-09-01",
        "Older idea",
      ].join("\n\n"),
    );
    expect(markdown).not.toContain("2026-09-30");
  });

  it("writes a single page under its date", () => {
    expect(pocketNotesMarkdown([note("2026-09-30", "Yesterday's idea")])).toBe(
      "# Pocket Notes\n\n## 2026-09-30\n\nYesterday's idea",
    );
  });

  it("keeps only the title when there are no pages", () => {
    expect(pocketNotesMarkdown([])).toBe("# Pocket Notes");
  });
});
