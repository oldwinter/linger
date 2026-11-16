import { describe, expect, it } from "vitest";

import {
  anotherMeArrival,
  type AnotherMeArrivalInput,
} from "./another-me-arrived";

const latest = {
  authorId: "actor-me",
  authorName: "Another Me",
  id: "message-2",
  raw: "I finished the notes.",
};

function input(
  extra: Partial<AnotherMeArrivalInput> = {},
): AnotherMeArrivalInput {
  return {
    agentActorId: "actor-me",
    held: false,
    here: false,
    latest,
    seenId: "message-1",
    ...extra,
  };
}

describe("anotherMeArrival", () => {
  it("brings a new message from Another Me when the person is elsewhere", () => {
    expect(anotherMeArrival(input())).toEqual({
      actorId: "actor-me",
      messageId: "message-2",
      name: "Another Me",
      text: "I finished the notes.",
    });
  });

  it("stays quiet on the first reading, in their chat, while held, or after it was dismissed", () => {
    expect(anotherMeArrival(input({ seenId: undefined }))).toBeUndefined();
    expect(anotherMeArrival(input({ here: true }))).toBeUndefined();
    expect(anotherMeArrival(input({ held: true }))).toBeUndefined();
    expect(
      anotherMeArrival(input({ dismissedId: "message-2" })),
    ).toBeUndefined();
    expect(
      anotherMeArrival(
        input({ latest: { ...latest, authorId: "actor-jenny" } }),
      ),
    ).toBeUndefined();
  });
});
