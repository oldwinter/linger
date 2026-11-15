import { describe, expect, it } from "vitest";

import { workItemCommentsMarkdown } from "./work-item-comments-markdown";

/** A local time string, so the expected clock time is the same everywhere. */
const createdAt = "2026-11-14T09:12:00";

describe("workItemCommentsMarkdown", () => {
  it("writes the title and one comment", () => {
    expect(
      workItemCommentsMarkdown({
        comments: [
          {
            authorName: "Ada Lovelace",
            body: "Handled the login path.",
            createdAt,
          },
        ],
        title: "Fix login failure",
      }),
    ).toBe(
      [
        "# Fix login failure",
        "**Ada Lovelace** · 2026-11-14 09:12",
        "Handled the login path.",
      ].join("\n\n"),
    );
  });

  it("keeps several comments in the order they were given", () => {
    expect(
      workItemCommentsMarkdown({
        comments: [
          {
            authorName: "Maya Chen",
            body: "Reproduced on staging.",
            createdAt: "2026-11-14T10:30:00",
          },
          {
            authorName: "Ada Lovelace",
            body: "The token refresh was the cause.",
            createdAt: "2026-11-14T11:05:00",
          },
        ],
        title: "Fix login failure",
      }),
    ).toBe(
      [
        "# Fix login failure",
        "**Maya Chen** · 2026-11-14 10:30",
        "Reproduced on staging.",
        "**Ada Lovelace** · 2026-11-14 11:05",
        "The token refresh was the cause.",
      ].join("\n\n"),
    );
  });

  it("keeps the author line of a comment with no body", () => {
    expect(
      workItemCommentsMarkdown({
        comments: [
          {
            authorName: "Maya Chen",
            body: " \n\n",
            createdAt: "2026-11-14T10:30:00",
          },
          {
            authorName: "Ada Lovelace",
            body: "Followed up.",
            createdAt: "2026-11-14T11:05:00",
          },
        ],
        title: "Fix login failure",
      }),
    ).toBe(
      [
        "# Fix login failure",
        "**Maya Chen** · 2026-11-14 10:30",
        "**Ada Lovelace** · 2026-11-14 11:05",
        "Followed up.",
      ].join("\n\n"),
    );
  });

  it("names an unknown author neutrally instead of leaving a gap", () => {
    expect(
      workItemCommentsMarkdown({
        comments: [
          { authorName: undefined, body: "Handled.", createdAt },
          { authorName: null, body: "Also handled.", createdAt },
        ],
        title: "Fix login failure",
      }),
    ).toBe(
      [
        "# Fix login failure",
        "**Unknown author** · 2026-11-14 09:12",
        "Handled.",
        "**Unknown author** · 2026-11-14 09:12",
        "Also handled.",
      ].join("\n\n"),
    );
  });

  it("writes only the title when the Item has no comments", () => {
    expect(
      workItemCommentsMarkdown({ comments: [], title: "Fix login failure" }),
    ).toBe("# Fix login failure");
  });
});
