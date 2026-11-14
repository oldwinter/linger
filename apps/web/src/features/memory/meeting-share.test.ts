import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingShare, meetingShareIdempotencyKey } from "./meeting-share";

const url =
  "https://linger.example/t/tenant-northstar/library/meetings?entry=meeting-1";

function meeting(
  overrides: Partial<TeamHubMemoryEntry> = {},
): TeamHubMemoryEntry {
  return {
    content: [
      "# Meeting 14-30-05",
      "",
      "## Decisions And Outcomes",
      "",
      "- Decision: Ship the beta.",
    ].join("\n"),
    id: "meeting-1",
    kind: "meeting",
    path: "Meetings/2026/09/23/Meeting 14-30-05",
    summary: "",
    title: "Meeting 14-30-05",
    updated_at: "2026-09-23T07:00:00Z",
    ...overrides,
  };
}

describe("meetingShare", () => {
  it("names the meeting, keeps its summary, and adds the link", () => {
    expect(meetingShare({ entry: meeting(), url }).text).toBe(
      [
        "# Meeting · Sep 23, 14:30",
        "## Decisions And Outcomes\n\n- Decision: Ship the beta.",
        url,
      ].join("\n\n"),
    );
  });

  it("falls back to the entry summary when the content has no summary", () => {
    const entry = meeting({ content: "", summary: "Shipped the beta." });

    expect(meetingShare({ entry, url }).text).toBe(
      ["# Meeting · Sep 23, 14:30", "Shipped the beta.", url].join("\n\n"),
    );
  });

  it("uses the entry title when the folder does not name a meeting", () => {
    const entry = meeting({ path: "Meetings/2026/09/23/notes.md" });

    expect(meetingShare({ entry, url }).text.split("\n")[0]).toBe(
      "# Meeting 14-30-05",
    );
  });

  it("changes its version with the summary revision", () => {
    expect(meetingShare({ entry: meeting(), url }).version).toBe(
      "meeting-1:2026-09-23T07:00:00Z",
    );
    expect(
      meetingShare({
        entry: meeting({ updated_at: "2026-09-23T08:00:00Z" }),
        url,
      }).version,
    ).not.toBe(meetingShare({ entry: meeting(), url }).version);
  });
});

describe("meetingShareIdempotencyKey", () => {
  const version = "meeting-1:2026-09-23T07:00:00Z";

  it("keeps one key per summary version and Room", () => {
    expect(meetingShareIdempotencyKey(version, "room-product")).toBe(
      meetingShareIdempotencyKey(version, "room-product"),
    );
  });

  it("gives another Room its own key", () => {
    expect(meetingShareIdempotencyKey(version, "room-all")).not.toBe(
      meetingShareIdempotencyKey(version, "room-product"),
    );
  });
});
