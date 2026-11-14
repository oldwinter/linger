import { describe, expect, it } from "vitest";

import { newMessagesStartIndex } from "./new-messages-mark";

const message = (authorId: string) => ({ authorId });

describe("new messages mark", () => {
  const thread = [
    message("ada"),
    message("me"),
    message("ada"),
    message("ada"),
  ];

  it("sits before the oldest unread Message from someone else", () => {
    expect(newMessagesStartIndex(thread, "me", 2)).toBe(2);
    expect(newMessagesStartIndex(thread, "me", 1)).toBe(3);
    expect(newMessagesStartIndex(thread, "me", 3)).toBe(0);
  });

  it("uses the top of the loaded page when older unread Messages are not loaded", () => {
    expect(newMessagesStartIndex(thread, "me", 8)).toBe(0);
  });

  it("draws nothing when nothing is unread or the page is empty", () => {
    expect(newMessagesStartIndex(thread, "me", 0)).toBeUndefined();
    expect(newMessagesStartIndex([], "me", 2)).toBeUndefined();
  });
});
