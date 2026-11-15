// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMeetingPlaybackSpeed,
  hasMeetingPlaybackSpeed,
  readMeetingPlaybackSpeed,
  writeMeetingPlaybackSpeed,
} from "./meeting-playback-speed";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("meeting playback speed store", () => {
  it("defaults to 1x when nothing is stored", () => {
    expect(readMeetingPlaybackSpeed("account-a")).toBe(1);
    expect(readMeetingPlaybackSpeed(undefined)).toBe(1);
  });

  it("reads the Account's stored speed and removes the key on default 1x", () => {
    writeMeetingPlaybackSpeed("account-a", 1.5);

    expect(readMeetingPlaybackSpeed("account-a")).toBe(1.5);
    expect(hasMeetingPlaybackSpeed()).toBe(true);

    writeMeetingPlaybackSpeed("account-a", 1);

    expect(readMeetingPlaybackSpeed("account-a")).toBe(1);
    expect(
      localStorage.getItem("meeting-playback-speed.v1:account-a"),
    ).toBeNull();
    expect(hasMeetingPlaybackSpeed()).toBe(false);
  });

  it("keeps each Account's speed apart", () => {
    writeMeetingPlaybackSpeed("account-a", 2);
    writeMeetingPlaybackSpeed("account-b", 0.75);

    expect(readMeetingPlaybackSpeed("account-a")).toBe(2);
    expect(readMeetingPlaybackSpeed("account-b")).toBe(0.75);
  });

  it("falls back to 1x for corrupt or unknown values", () => {
    for (const stored of ['"fast"', "1.37", "0", "3", "true", "null", "{"]) {
      window.localStorage.setItem(
        "meeting-playback-speed.v1:account-a",
        stored,
      );

      expect(readMeetingPlaybackSpeed("account-a"), stored).toBe(1);
    }
  });

  it("defaults to 1x when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is blocked");
    });

    expect(readMeetingPlaybackSpeed("account-a")).toBe(1);
  });

  it("ignores a write without an Account", () => {
    writeMeetingPlaybackSpeed(undefined, 2);

    expect(hasMeetingPlaybackSpeed()).toBe(false);
  });

  it("clears every Account's speed for Settings", () => {
    writeMeetingPlaybackSpeed("account-a", 2);
    writeMeetingPlaybackSpeed("account-b", 0.75);

    clearMeetingPlaybackSpeed();

    expect(hasMeetingPlaybackSpeed()).toBe(false);
    expect(readMeetingPlaybackSpeed("account-a")).toBe(1);
    expect(readMeetingPlaybackSpeed("account-b")).toBe(1);
  });
});
