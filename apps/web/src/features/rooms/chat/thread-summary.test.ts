import { describe, expect, it } from "vitest";

import { threadReplyLabel, threadSummary } from "./thread-summary";

const ana = { id: "actor-ana", name: "Ana" };
const ben = { id: "actor-ben", name: "Ben" };
const cy = { id: "actor-cy", name: "Cy" };
const dee = { id: "actor-dee", name: "Dee" };

describe("threadSummary", () => {
  it("counts the replies and names the root author first", () => {
    expect(threadSummary({ replies: [ben, ana, cy], rootAuthor: ana })).toEqual(
      {
        participants: ["Ana", "Ben", "Cy"],
        replyCount: 3,
        short: "Ana, Ben +1",
      },
    );
  });

  it("summarizes a Thread with no replies", () => {
    expect(threadSummary({ replies: [], rootAuthor: ana })).toEqual({
      participants: ["Ana"],
      replyCount: 0,
      short: "Ana",
    });
  });

  it("summarizes a Thread with one reply", () => {
    expect(threadSummary({ replies: [ben], rootAuthor: ana })).toEqual({
      participants: ["Ana", "Ben"],
      replyCount: 1,
      short: "Ana, Ben",
    });
  });

  it("keeps each participant once, in the order they first appear", () => {
    expect(
      threadSummary({ replies: [ben, ben, ana, cy, ben], rootAuthor: ana }),
    ).toEqual({
      participants: ["Ana", "Ben", "Cy"],
      replyCount: 5,
      short: "Ana, Ben +1",
    });
  });

  it("counts the names the header does not show", () => {
    expect(
      threadSummary({ replies: [ben, cy, dee], rootAuthor: ana }).short,
    ).toBe("Ana, Ben +2");
    expect(threadSummary({ replies: [ben, dee], rootAuthor: ana }).short).toBe(
      "Ana, Ben +1",
    );
    expect(threadSummary({ replies: [ben], rootAuthor: ana }).short).toBe(
      "Ana, Ben",
    );
  });
});

describe("threadReplyLabel", () => {
  it("says no replies, one reply, or a count", () => {
    expect(threadReplyLabel(0)).toBe("No replies");
    expect(threadReplyLabel(1)).toBe("1 reply");
    expect(threadReplyLabel(2)).toBe("2 replies");
  });
});
