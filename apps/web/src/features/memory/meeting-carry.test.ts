import { afterEach, describe, expect, it, vi } from "vitest";

import {
  carriedMeetingFromLeave,
  carriedMeetingSnapshot,
  carryMeeting,
  currentMeetingPlaybackSession,
  releaseCarriedMeeting,
  resetMeetingPlaybackSession,
} from "./meeting-carry";

const source = {
  accountId: "account-jenny",
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
        { ...source, playback: undefined },
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
  it("rejects a late handoff from a cleared Session and accepts a new one", () => {
    const staleSession = currentMeetingPlaybackSession();
    const carriedDispose = vi.fn();
    const staleDispose = vi.fn();
    const freshDispose = vi.fn();
    const meeting = carriedMeetingFromLeave(
      { ...source, playback: { ...source.playback, dispose: carriedDispose } },
      { playing: true, rate: 1, seconds: 8 },
    )!;
    expect(carryMeeting(meeting, staleSession)).toBe(true);

    resetMeetingPlaybackSession();
    resetMeetingPlaybackSession();
    expect(carriedMeetingSnapshot()).toBeUndefined();
    expect(carriedDispose).toHaveBeenCalledOnce();
    expect(
      carryMeeting({ ...meeting, dispose: staleDispose }, staleSession),
    ).toBe(false);
    expect(staleDispose).not.toHaveBeenCalled();
    expect(carriedMeetingSnapshot()).toBeUndefined();

    expect(
      carryMeeting(
        { ...meeting, dispose: freshDispose },
        currentMeetingPlaybackSession(),
      ),
    ).toBe(true);
    releaseCarriedMeeting();
    expect(freshDispose).toHaveBeenCalledOnce();
    expect(carriedDispose).toHaveBeenCalledOnce();
  });

  it("holds one recording and releases its playback when it is left behind", () => {
    const dispose = vi.fn();
    carryMeeting(
      carriedMeetingFromLeave(
        { ...source, playback: { ...source.playback, dispose } },
        { playing: true, rate: 1, seconds: 8 },
      )!,
      currentMeetingPlaybackSession(),
    );
    expect(carriedMeetingSnapshot()).toMatchObject({
      meetingId: "meeting-1",
      src: source.playback.url,
    });
    releaseCarriedMeeting();
    expect(carriedMeetingSnapshot()).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("releases each playback once when another recording replaces it", () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    carryMeeting(
      carriedMeetingFromLeave(
        { ...source, playback: { ...source.playback, dispose: firstDispose } },
        { playing: true, rate: 1, seconds: 8 },
      )!,
      currentMeetingPlaybackSession(),
    );
    carryMeeting(
      carriedMeetingFromLeave(
        {
          ...source,
          meetingId: "meeting-2",
          playback: { ...source.playback, dispose: secondDispose },
        },
        { playing: true, rate: 1, seconds: 24 },
      )!,
      currentMeetingPlaybackSession(),
    );

    expect(carriedMeetingSnapshot()?.meetingId).toBe("meeting-2");
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).not.toHaveBeenCalled();

    releaseCarriedMeeting();
    releaseCarriedMeeting();
    expect(carriedMeetingSnapshot()).toBeUndefined();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
  });
});
