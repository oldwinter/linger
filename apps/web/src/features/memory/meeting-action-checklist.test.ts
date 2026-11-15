import { describe, expect, it } from "vitest";

import { meetingActionChecklist } from "./meeting-action-checklist";
import type { MeetingOutcome } from "./meeting-overview";

function outcome(
  label: MeetingOutcome["label"],
  text: string,
  children: string[] = [],
): MeetingOutcome {
  return { children, label, text };
}

describe("meetingActionChecklist", () => {
  it("writes the Actions as a checklist and indents their children", () => {
    expect(
      meetingActionChecklist([
        outcome("Action", "Send the revised budget to Finance"),
        outcome("Action", "Book the follow-up review", ["Confirm the room"]),
      ]),
    ).toBe(
      [
        "- [ ] Send the revised budget to Finance",
        "- [ ] Book the follow-up review",
        "  - [ ] Confirm the room",
      ].join("\n"),
    );
  });

  it("keeps page order and leaves out outcomes that are not Actions", () => {
    expect(
      meetingActionChecklist([
        outcome("Decision", "Ship the beta."),
        outcome("Action", "Send the deck."),
        outcome(null, "Noted context."),
        outcome("Completed", "Cut the release branch."),
        outcome("Action", "Book the venue."),
      ]),
    ).toBe("- [ ] Send the deck.\n- [ ] Book the venue.");
  });

  it("skips empty and whitespace-only text, and skips a child with none", () => {
    expect(
      meetingActionChecklist([
        outcome("Action", "   "),
        outcome("Action", "Call the vendor.", ["", "  ", "Ask about delivery"]),
        outcome("Action", ""),
      ]),
    ).toBe("- [ ] Call the vendor.\n  - [ ] Ask about delivery");
  });

  it("writes Markdown inside an Action as readable text", () => {
    expect(
      meetingActionChecklist([
        outcome("Action", "Send **the** [budget](https://example.test)"),
      ]),
    ).toBe("- [ ] Send the budget");
  });

  it("keeps one checklist line per item", () => {
    expect(meetingActionChecklist([outcome("Action", "Send\nthe deck.")])).toBe(
      "- [ ] Send the deck.",
    );
  });

  it("is empty when the meeting has no Actions", () => {
    expect(
      meetingActionChecklist([
        outcome("Decision", "Ship the beta."),
        outcome("Completed", "Cut the release branch."),
      ]),
    ).toBe("");
    expect(meetingActionChecklist([])).toBe("");
  });
});
