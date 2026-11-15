import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import {
  MEETING_START_GRACE_MS,
  nextMeetingStart,
  openMeetingId,
  shouldOpenMeetingAtStart,
} from "./meeting-begins";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    id,
    kind: "meeting",
    title: id,
    path,
    content: "",
    summary: "",
    updated_at: "2026-11-16T00:00:00Z",
    meeting: {
      capture_id: `capture-${id}`,
      started_at: "2026-11-16T00:00:00Z",
      recording_document_id: "audio",
      recording_version_id: "audio-v1",
      recording_filename: "recording.m4a",
      transcript_document_id: "transcript",
      transcript_version_id: "transcript-v1",
      summary_ready: false,
    },
  };
}

const open = {
  alreadyThere: false,
  dialogOpen: false,
  visible: true,
  writing: false,
};

describe("nextMeetingStart", () => {
  it("picks the soonest meeting that has not started", () => {
    const now = new Date(2026, 10, 16, 9, 0, 0).getTime();
    expect(
      nextMeetingStart(
        [
          meeting("later", "Meetings/2026/11/16/Meeting 11-00-00"),
          meeting("next", "Meetings/2026/11/16/Meeting 09-30-00"),
          meeting("past", "Meetings/2026/11/16/Meeting 08-00-00"),
        ],
        now,
      )?.id,
    ).toBe("next");
  });
});

describe("shouldOpenMeetingAtStart", () => {
  const start = new Date(2026, 10, 16, 9, 30, 0).getTime();

  it("opens at the start and stays put when the person is busy or already there", () => {
    expect(
      shouldOpenMeetingAtStart({ ...open, nowMs: start, startMs: start }),
    ).toBe(true);
    expect(
      shouldOpenMeetingAtStart({
        ...open,
        nowMs: start + MEETING_START_GRACE_MS + 1,
        startMs: start,
      }),
    ).toBe(false);
    expect(
      shouldOpenMeetingAtStart({
        ...open,
        nowMs: start,
        startMs: start,
        writing: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenMeetingAtStart({
        ...open,
        alreadyThere: true,
        nowMs: start,
        startMs: start,
      }),
    ).toBe(false);
  });
});

describe("openMeetingId", () => {
  it("reads the meeting named in the URL", () => {
    expect(
      openMeetingId("/t/tenant-a/library/meetings", "?entry=meeting-1"),
    ).toBe("meeting-1");
    expect(openMeetingId("/t/tenant-a/rooms/room-1/chat", "")).toBeNull();
  });
});
