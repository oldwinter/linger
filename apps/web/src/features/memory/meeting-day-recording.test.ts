import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import {
  continuesRecording,
  nextRecordingSameDay,
} from "./meeting-day-recording";

function meeting(
  id: string,
  path: string,
  recording = "audio",
): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: id,
      recording_document_id: recording,
      recording_filename: recording ? "room.m4a" : "",
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

const day = [
  meeting("late", "Meetings/2026/10/01/Meeting 17-00-00"),
  meeting("early", "Meetings/2026/10/01/Meeting 09-05-00"),
  meeting("notes", "Meetings/2026/10/01/Meeting 12-00-00", ""),
  meeting("next-day", "Meetings/2026/10/02/Meeting 09-00-00"),
];

describe("continuesRecording", () => {
  it("accepts only the continuation flag", () => {
    expect(continuesRecording({ continueRecording: true })).toBe(true);
    expect(continuesRecording({ continueRecording: false })).toBe(false);
    expect(continuesRecording(null)).toBe(false);
  });
});

describe("nextRecordingSameDay", () => {
  it("continues to the next recording that day and stops at the last", () => {
    expect(nextRecordingSameDay(day, "early")).toBe("late");
    expect(nextRecordingSameDay(day, "late")).toBeUndefined();
    expect(nextRecordingSameDay(day, "missing")).toBeUndefined();
  });
});
