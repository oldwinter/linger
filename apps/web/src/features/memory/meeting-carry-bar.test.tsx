import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { MeetingCarryBar } from "./meeting-carry-bar";
import {
  carriedMeetingFromLeave,
  carriedMeetingSnapshot,
  carryMeeting,
  currentMeetingPlaybackSession,
  releaseCarriedMeeting,
} from "./meeting-carry";

const source = {
  filename: "recording.m4a",
  href: "/t/tenant-northstar/library/meetings?entry=meeting-1",
  mediaType: "audio/mp4",
  meetingId: "meeting-1",
  playback: {
    dispose: () => undefined,
    url: "/v0/document-versions/audio-version/content",
  },
  title: "Monday standup",
};

afterEach(() => {
  releaseCarriedMeeting();
  vi.restoreAllMocks();
});

function renderBar() {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  carryMeeting(
    carriedMeetingFromLeave(source, { playing: true, rate: 1, seconds: 12 })!,
    currentMeetingPlaybackSession(),
  );
  const router = createMemoryRouter([
    { path: "/", element: <MeetingCarryBar /> },
  ]);
  render(<RouterProvider router={router} />);
}

describe("MeetingCarryBar", () => {
  it("names the meeting that is still playing and links back to it", () => {
    renderBar();
    expect(
      screen.getByRole("region", { name: "Meeting still playing" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Monday standup" }),
    ).toHaveAttribute("href", source.href);
  });

  it("leaves the recording behind", () => {
    renderBar();
    fireEvent.click(
      screen.getByRole("button", { name: "Leave the recording" }),
    );
    expect(carriedMeetingSnapshot()).toBeUndefined();
    expect(
      screen.queryByRole("region", { name: "Meeting still playing" }),
    ).toBeNull();
  });
});
