import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

import type { MeetingOutcome } from "./meeting-overview";

/**
 * The meeting's Action items as a Markdown checklist, in page order, with each
 * child indented two spaces under its Action. Outcomes without text produce no
 * line, so a meeting with no Actions produces an empty string.
 */
export function meetingActionChecklist(
  outcomes: readonly MeetingOutcome[],
): string {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.label !== "Action") continue;
    const text = checklistText(outcome.text);
    if (!text) continue;
    lines.push(`- [ ] ${text}`);
    for (const child of outcome.children) {
      const childText = checklistText(child);
      if (childText) lines.push(`  - [ ] ${childText}`);
    }
  }
  return lines.join("\n");
}

/** One checklist line per item, so a label's own line breaks collapse. */
function checklistText(text: string): string {
  return markdownPlainText(text).replace(/\s+/gu, " ").trim();
}
