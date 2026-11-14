import { describe, expect, it } from "vitest";

import {
  nextMatchPosition,
  previousMatchPosition,
  searchMeetingTranscript,
} from "./meeting-transcript-search";

const turns = [
  "Sure, then follow this format here.",
  "Look, it blinks, but it does not tell you it is recording.",
  "Right, so I feel like our earlier one looked like this.",
  "Like we should build it ourselves. Send me a screenshot, I am online.",
];

describe("searchMeetingTranscript", () => {
  it("matches nothing for an empty or whitespace query", () => {
    expect(searchMeetingTranscript(turns, "")).toEqual({
      count: 0,
      indices: [],
      words: [],
    });
    expect(searchMeetingTranscript(turns, "  \n ").count).toBe(0);
  });

  it("finds one turn case-insensitively", () => {
    expect(searchMeetingTranscript(turns, "BLINKS").indices).toEqual([1]);
    expect(searchMeetingTranscript(turns, "recording").count).toBe(1);
  });

  it("keeps every matching turn in spoken order", () => {
    expect(searchMeetingTranscript(turns, "like")).toMatchObject({
      count: 2,
      indices: [2, 3],
    });
  });

  it("requires every word in the same turn", () => {
    expect(searchMeetingTranscript(turns, "blinks recording").indices).toEqual([
      1,
    ]);
    expect(searchMeetingTranscript(turns, "blinks screenshot").indices).toEqual(
      [],
    );
    expect(searchMeetingTranscript(turns, "recording screenshot").count).toBe(
      0,
    );
  });

  it("matches nothing when no turn holds the words", () => {
    expect(searchMeetingTranscript(turns, "nonexistent").count).toBe(0);
  });
});

describe("match navigation", () => {
  it("wraps Next from the last match to the first", () => {
    expect(nextMatchPosition(0, 3)).toBe(1);
    expect(nextMatchPosition(1, 3)).toBe(2);
    expect(nextMatchPosition(2, 3)).toBe(0);
  });

  it("wraps Previous from the first match to the last", () => {
    expect(previousMatchPosition(0, 3)).toBe(2);
    expect(previousMatchPosition(2, 3)).toBe(1);
    expect(previousMatchPosition(1, 3)).toBe(0);
  });

  it("stays at zero without matches", () => {
    expect(nextMatchPosition(0, 0)).toBe(0);
    expect(previousMatchPosition(0, 0)).toBe(0);
  });
});
