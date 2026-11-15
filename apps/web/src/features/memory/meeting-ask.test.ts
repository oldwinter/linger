// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  clearRoomDrafts,
  readRoomComposerDraft,
  writeRoomComposerDraft,
} from "@/features/rooms/room-drafts";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import {
  askAnotherMeAboutMeeting,
  followUpsFromMeeting,
  meetingAskPrompt,
  withMeetingAsk,
} from "./meeting-ask";

afterEach(() => {
  clearRoomDrafts();
});

const meeting = {
  content:
    "## Decisions And Outcomes\n\n- Decision: Ship the brief on Friday\n\n## Action Items\n\n- Action: Send the recap\n- Action: None observed.\n",
  path: "Meetings/2026/11/14/Meeting 09-05-00",
  title: "Meeting 09-05-00",
} as TeamHubMemoryEntry;

describe("meeting ask", () => {
  it("names the meeting and keeps the decisions and actions", () => {
    expect(followUpsFromMeeting(meeting.content)).toEqual([
      "Ship the brief on Friday",
      "Send the recap",
    ]);
    expect(meetingAskPrompt("Meeting Nov 14, 09:05", ["Send the recap"])).toBe(
      "Help me follow up on Meeting Nov 14, 09:05.\n\n- Send the recap",
    );
  });

  it("asks what to do next when the meeting has no follow-ups", () => {
    expect(meetingAskPrompt("Meeting Nov 14, 09:05", [])).toBe(
      "Help me follow up on Meeting Nov 14, 09:05.\n\nI just read it. What should I do next?",
    );
  });

  it("appends the ask under an unsent draft and does not repeat it", () => {
    expect(withMeetingAsk("Call Mom", "Help me follow up.")).toBe(
      "Call Mom\n\nHelp me follow up.",
    );
    expect(
      withMeetingAsk("Call Mom\n\nHelp me follow up.", "Help me follow up."),
    ).toBe("Call Mom\n\nHelp me follow up.");
    expect(withMeetingAsk("   ", "Help me follow up.")).toBe(
      "Help me follow up.",
    );
  });

  it("leaves an existing Another Me draft in place and opens that chat", () => {
    const scope = {
      accountId: "account-jenny",
      roomId: "room-another-me",
      tenantId: "tenant-northstar",
    };
    writeRoomComposerDraft(scope, {
      body: "Remind me about the orchids",
      documentContexts: [],
      documentReferences: [],
      mentions: [],
      skillReferences: [],
    });

    const placed = askAnotherMeAboutMeeting({
      ...scope,
      entry: meeting,
    });

    expect(placed.to).toBe("/t/tenant-northstar/rooms/room-another-me/chat");
    expect(placed.state).toEqual({ focusComposer: true });
    expect(readRoomComposerDraft(scope).body).toBe(
      "Remind me about the orchids\n\nHelp me follow up on Meeting Nov 14, 09:05.\n\n- Ship the brief on Friday\n- Send the recap",
    );
    expect(askAnotherMeAboutMeeting({ ...scope, entry: meeting }).body).toBe(
      readRoomComposerDraft(scope).body,
    );
  });
});
