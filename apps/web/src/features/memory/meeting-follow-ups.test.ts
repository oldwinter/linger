// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { MeetingOutcome } from "./meeting-overview";
import {
  followUpProgress,
  followUpTexts,
  readMeetingFollowUps,
  toggleFollowUp,
  writeMeetingFollowUps,
} from "./meeting-follow-ups";

afterEach(() => {
  localStorage.clear();
});

const outcomes: MeetingOutcome[] = [
  { label: "Action", text: "Send the recap", children: [] },
  { label: "Action", text: " None observed. ", children: [] },
  { label: null, text: "   ", children: [] },
  { label: "Action", text: "Book the room", children: ["Owner: Lin"] },
];

describe("meeting follow-ups", () => {
  it("keeps real action lines and ignores an empty to-do", () => {
    expect(followUpTexts(outcomes)).toEqual([
      "Send the recap",
      "Book the room",
    ]);
    expect(
      followUpProgress(
        ["Send the recap", "Book the room"],
        ["Book the room", "Old"],
      ),
    ).toEqual({
      done: 1,
      total: 2,
    });
  });

  it("checks and unchecks one line", () => {
    const once = toggleFollowUp([], "Send the recap");
    expect(once).toEqual(["Send the recap"]);
    expect(toggleFollowUp(once, "Send the recap")).toEqual([]);
  });

  it("keeps each meeting's checks apart for the same account", () => {
    writeMeetingFollowUps("account-jenny", "capture-a", ["Send the recap"]);
    writeMeetingFollowUps("account-jenny", "capture-b", ["Book the room"]);
    expect(readMeetingFollowUps("account-jenny", "capture-a")).toEqual([
      "Send the recap",
    ]);
    expect(readMeetingFollowUps("account-other", "capture-a")).toEqual([]);
    writeMeetingFollowUps("account-jenny", "capture-a", []);
    expect(readMeetingFollowUps("account-jenny", "capture-a")).toEqual([]);
  });
});
