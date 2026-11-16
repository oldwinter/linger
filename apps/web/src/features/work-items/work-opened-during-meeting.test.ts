import { describe, expect, it } from "vitest";

import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import {
  workOpenedDuringMeeting,
  workOpenedDuringMeetingText,
} from "./work-opened-during-meeting";

function meeting(id: string, start: Date): TeamHubMemoryEntry {
  const pad = (value: number) => String(value).padStart(2, "0");
  const path = `Meetings/${start.getFullYear()}/${pad(start.getMonth() + 1)}/${pad(start.getDate())}/Meeting ${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: id,
      recording_document_id: "audio",
      recording_filename: "room.m4a",
      recording_version_id: "v1",
      started_at: start.toISOString(),
      summary_ready: false,
      transcript_document_id: "transcript",
      transcript_version_id: "v1",
    },
    path,
    summary: "",
    title: path,
    updated_at: start.toISOString(),
  };
}

describe("work opened during a meeting", () => {
  const start = new Date(2026, 10, 14, 10, 0, 0);
  const entries = [
    meeting("earlier", new Date(2026, 10, 14, 8, 0, 0)),
    meeting("planning", start),
  ];

  it("names the meeting that was underway and how far in", () => {
    const opened = workOpenedDuringMeeting(
      entries,
      new Date(2026, 10, 14, 10, 18, 0),
      "tenant-northstar",
    );
    expect(opened).toMatchObject({
      href: "/t/tenant-northstar/library/meetings?entry=planning",
      label: "Meeting · Nov 14, 10:00",
      minutesIn: 18,
    });
    expect(workOpenedDuringMeetingText(opened!)).toBe(
      "Opened 18 minutes into Meeting · Nov 14, 10:00.",
    );
  });

  it("stays quiet once the meeting's underway window has passed", () => {
    expect(
      workOpenedDuringMeeting(
        entries,
        new Date(2026, 10, 14, 12, 0, 0),
        "tenant-northstar",
      ),
    ).toBeUndefined();
    expect(
      workOpenedDuringMeetingText({
        href: "/meeting",
        label: "Meeting · Nov 14, 10:00",
        minutesIn: 0,
      }),
    ).toBe("Opened as Meeting · Nov 14, 10:00 began.");
  });
});
