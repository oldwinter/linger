// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { readMeetingPlayback, writeMeetingPlayback } from "./meeting-playback";

afterEach(() => {
  localStorage.clear();
});

describe("meeting playback", () => {
  it("keeps one account's place in one recording", () => {
    writeMeetingPlayback("account-jenny", "capture-a", 65, 600);
    expect(readMeetingPlayback("account-jenny", "capture-a")).toBe(65);
    expect(readMeetingPlayback("account-other", "capture-a")).toBe(0);
    expect(readMeetingPlayback("account-jenny", "capture-b")).toBe(0);
  });

  it("drops a place at the start or the end", () => {
    writeMeetingPlayback("account-jenny", "capture-a", 2, 600);
    expect(readMeetingPlayback("account-jenny", "capture-a")).toBe(0);
    writeMeetingPlayback("account-jenny", "capture-a", 65, 600);
    writeMeetingPlayback("account-jenny", "capture-a", 598, 600);
    expect(readMeetingPlayback("account-jenny", "capture-a")).toBe(0);
  });
});
