import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { loadNoteFromThatDay, noteFromThatDay } from "./note-from-that-day";

describe("note from that day", () => {
  const notes = [
    { date: "2026-11-14", text: "  Call Lisa about the quote.  " },
    { date: "2026-11-13", text: "   " },
  ];

  it("returns the trimmed note written on the work item's day", () => {
    expect(noteFromThatDay(notes, "2026-11-14")).toBe(
      "Call Lisa about the quote.",
    );
  });

  it("stays quiet when that day has no words", () => {
    expect(noteFromThatDay(notes, "2026-11-13")).toBeUndefined();
    expect(noteFromThatDay(notes, "2026-11-12")).toBeUndefined();
  });

  it("resolves to null instead of undefined when no note exists for that day", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
      items: [],
      page: { has_more: false },
      today: "2026-11-14",
    }));

    await expect(
      loadNoteFromThatDay(runtime.client, "tenant-northstar", "2026-11-12"),
    ).resolves.toBeNull();
  });
});
