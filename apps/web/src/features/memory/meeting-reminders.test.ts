import { describe, expect, it } from "vitest";

import {
  defaultReminderLocalValue,
  meetingTodoTexts,
  reminderInstruction,
  reminderName,
} from "./meeting-reminders";

describe("meeting reminders", () => {
  it("reads to-dos and drops an empty action list", () => {
    expect(
      meetingTodoTexts(
        "## Action Items\n\n- Send the notes\n- None observed.\n\nCall the client.",
      ),
    ).toEqual(["Send the notes", "Call the client."]);
    expect(meetingTodoTexts("## Action Items\n\nNone observed.\n")).toEqual([]);
  });

  it("defaults the reminder to 09:00 tomorrow and keeps the name within 120 characters", () => {
    expect(defaultReminderLocalValue(new Date(2026, 10, 14, 22, 5))).toBe(
      "2026-11-15T09:00",
    );
    expect(reminderName(`  ${"a".repeat(130)}  `)).toHaveLength(120);
    expect(reminderInstruction("Meeting Nov 14, 09:05", "Send the notes")).toBe(
      "From Meeting Nov 14, 09:05, remind me:\n\nSend the notes",
    );
  });
});
