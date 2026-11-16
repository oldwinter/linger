import { describe, expect, it } from "vitest";

import {
  meetingEndedWithoutDecision,
  meetingOpensOnLastWords,
  meetingReadingTab,
} from "./meeting-without-decision";

const noDecision = `## Decisions And Outcomes

- Completed: The brief is written.

## Action Items

- Action: Send the deck.
`;

const decided = `## Decisions And Outcomes

- Decision: Ship the beta.
`;

describe("meetingEndedWithoutDecision", () => {
  it("is a finished outcomes summary with no decision", () => {
    expect(meetingEndedWithoutDecision(noDecision)).toBe(true);
    expect(meetingEndedWithoutDecision(decided)).toBe(false);
    expect(meetingEndedWithoutDecision("## Notes\n\nWe talked.")).toBe(false);
  });
});

describe("meetingReadingTab", () => {
  it("opens a decision-less meeting on the transcript and leaves the last words", () => {
    expect(meetingReadingTab(null, true, noDecision)).toBe("transcript");
    expect(meetingOpensOnLastWords(null, true, noDecision)).toBe(true);
    expect(meetingReadingTab(null, true, decided)).toBe("summary");
    expect(meetingOpensOnLastWords(null, true, decided)).toBe(false);
    expect(meetingReadingTab("summary", true, noDecision)).toBe("summary");
    expect(meetingOpensOnLastWords("summary", true, noDecision)).toBe(false);
  });
});
