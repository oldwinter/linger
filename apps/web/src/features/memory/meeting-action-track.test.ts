import { describe, expect, it } from "vitest";

import {
  draftWithTrackedAction,
  meetingActionBlock,
} from "./meeting-action-track";

const block = meetingActionBlock({
  action: "Send the recap",
  meetingLink: "https://linger.example/meetings?entry=1",
  meetingTitle: "Meeting · Oct 1, 09:05",
});

describe("draft with a tracked action", () => {
  it("adds the action to an empty draft and keeps other text ahead of it", () => {
    expect(draftWithTrackedAction("", block)).toBe(block);
    expect(draftWithTrackedAction("Hold this thought.", block)).toBe(
      `Hold this thought.\n\n${block}`,
    );
  });

  it("does not ask again when that action is already in the draft", () => {
    const once = draftWithTrackedAction("Hold this thought.", block);
    expect(draftWithTrackedAction(once, block)).toBe(once);
    expect(draftWithTrackedAction(`\n\n${block}\n`, block)).toBe(block);
  });
});
