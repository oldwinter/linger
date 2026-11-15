import { afterEach, describe, expect, it, vi } from "vitest";

import {
  carriedMeetingFromLeave,
  carriedMeetingSnapshot,
  carryMeeting,
  releaseCarriedMeeting,
} from "./meeting-carry";

const source = {
  accountId: "account-jenny",
  blob: new Blob(["audio"], { type: "audio/mp4" }),
  filename: "recording.m4a",
  href: "/t/tenant-northstar/library/meetings?entry=meeting-1",
  mediaType: "audio/mp4",
  meetingId: "meeting-1",
  title: "Monday standup",
};

afterEach(() => {
  releaseCarriedMeeting();
  vi.restoreAllMocks();
});

describe("carriedMeetingFromLeave", () => {
  it("keeps a playing audio recording at the second it was left", () => {
    expect(
      carriedMeetingFromLeave(source, {
        playing: true,
        rate: 1.25,
        seconds: 42,
      }),
    ).toMatchObject({
      meetingId: "meeting-1",
      rate: 1.25,
      seconds: 42,
      title: "Monday standup",
    });
  });

  it("leaves a paused recording, a missing file, and a non-audio preview behind", () => {
    expect(
      carriedMeetingFromLeave(source, { playing: false, rate: 1, seconds: 42 }),
    ).toBeUndefined();
    expect(
      carriedMeetingFromLeave(
        { ...source, blob: undefined },
        { playing: true, rate: 1, seconds: 4 },
      ),
    ).toBeUndefined();
    expect(
      carriedMeetingFromLeave(
        { ...source, mediaType: "text/markdown" },
        { playing: true, rate: 1, seconds: 4 },
      ),
    ).toBeUndefined();
  });
});

describe("carryMeeting", () => {
  it("holds one recording and frees its blob URL when it is left behind", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:carried");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    carryMeeting(
      carriedMeetingFromLeave(source, {
        playing: true,
        rate: 1,
        seconds: 8,
      })!,
    );
    expect(carriedMeetingSnapshot()).toMatchObject({
      meetingId: "meeting-1",
      src: "blob:carried",
    });
    releaseCarriedMeeting();
    expect(carriedMeetingSnapshot()).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:carried");
  });
});
