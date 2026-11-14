import { describe, expect, it } from "vitest";

import { meetingStoryBeats, storySentence } from "./meeting-story";

const markdown = `## Decisions And Outcomes

- Decision: Ship the Friday release.
- Completed: The design review.

## Meeting Summary

### Release plan

- Open the beta.

## Action Items

- Action: Send the notes.
`;

describe("meetingStoryBeats", () => {
  it("turns decisions, scenes, and open work into lines you could say", () => {
    expect(meetingStoryBeats(markdown).map(storySentence)).toEqual([
      "You decided: Ship the Friday release.",
      "You finished: The design review.",
      "You talked about Release plan.",
      "Still open: Send the notes.",
    ]);
  });
});
