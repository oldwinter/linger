import { describe, expect, it } from "vitest";

import {
  conversationBeganAt,
  earlierConversationEnd,
} from "./earlier-conversation";

const first = "2026-10-22T10:00:00.000Z";
const soon = "2026-10-22T10:04:00.000Z";
const later = "2026-10-22T10:10:00.000Z";
const nextDay = "2026-10-23T10:00:00.000Z";

function at(createdAt: string) {
  return { created_at: createdAt };
}

describe("earlierConversationEnd", () => {
  it("steps back one conversation, keeping messages a few minutes apart together", () => {
    const messages = [at(first), at(soon), at(later), at(nextDay)];
    expect(earlierConversationEnd(messages)).toBe(later);
    expect(earlierConversationEnd(messages, later)).toBe(soon);
    expect(earlierConversationEnd(messages, soon)).toBeUndefined();
    expect(conversationBeganAt(messages, later)).toBe(later);
    expect(conversationBeganAt(messages, soon)).toBe(first);
  });

  it("has no earlier conversation when the room is one stretch", () => {
    expect(earlierConversationEnd([at(first), at(soon)])).toBeUndefined();
  });
});
