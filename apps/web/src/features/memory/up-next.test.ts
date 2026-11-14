import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { chooseUpNext, countdownPhrase, describeUpNext } from "./up-next";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: id,
      recording_document_id: "audio",
      recording_filename: "room.m4a",
      recording_version_id: "v1",
      started_at: "2026-10-01T09:00:00Z",
      summary_ready: false,
      transcript_document_id: "transcript",
      transcript_version_id: "v1",
    },
    path,
    summary: "",
    title: path,
    updated_at: "2026-10-01T09:00:00Z",
  };
}

const entries = [
  meeting("morning", "Meetings/2026/10/01/Meeting 09-05-00"),
  meeting("afternoon", "Meetings/2026/10/01/Meeting 17-41-02"),
];

describe("up next", () => {
  it("counts down to the next meeting and names one already underway", () => {
    const afternoon = new Date(2026, 9, 1, 16, 0, 0);
    const next = chooseUpNext(entries, afternoon);
    expect(next?.label).toBe("Meeting · Oct 1, 17:41");
    expect(next?.phase).toBe("later");
    expect(describeUpNext(next, afternoon)).toMatchObject({
      clock: "01:41:02",
      detail: "It starts in 1 hour 42 minutes.",
      headline: "Meeting · Oct 1, 17:41 is next.",
    });

    const underway = new Date(2026, 9, 1, 17, 50, 0);
    const live = chooseUpNext(entries, underway);
    expect(live?.phase).toBe("underway");
    expect(describeUpNext(live, underway).headline).toBe(
      "Meeting · Oct 1, 17:41 is underway.",
    );

    const later = new Date(2026, 9, 1, 20, 0, 0);
    expect(chooseUpNext(entries, later)).toBeUndefined();
    expect(describeUpNext(undefined, later).headline).toBe(
      "The clock is clear.",
    );
    expect(countdownPhrase(30_000)).toBe("It starts now.");
  });
});
