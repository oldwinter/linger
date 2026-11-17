import type { CommentData } from "@blocknote/core/comments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { commentBodyFromComposition } from "./room-document-comment-body";
import { RoomDocumentCommentRow } from "./room-document-comment-row";
import type { TeamHubDocumentThreadStore } from "./room-document-comments";

const author: TeamHubActorRef = {
  id: "agent-reviewer",
  tenant_id: "tenant_1",
  kind: "agent",
  display_name: "Reviewer",
};
const human: TeamHubActorRef = {
  id: "human-alice",
  tenant_id: "tenant_1",
  kind: "human",
  display_name: "Alice",
};

function renderComment(
  body: string,
  updateComment?: TeamHubDocumentThreadStore["updateComment"],
) {
  const comment: CommentData = {
    type: "comment",
    id: "comment_1",
    userId: author.id,
    createdAt: new Date("2026-09-20T00:00:00Z"),
    updatedAt: new Date("2026-09-20T00:00:00Z"),
    reactions: [],
    body: commentBodyFromComposition({ body, files: [], mentions: [human] }),
    metadata: { author },
  };
  const threadStore = {
    auth: {
      canDeleteReaction: () => false,
      canAddReaction: () => false,
      canUpdateComment: () => Boolean(updateComment),
      canDeleteComment: () => false,
    },
    updateComment,
  } as unknown as TeamHubDocumentThreadStore;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RoomDocumentCommentRow
        actors={
          new Map([
            [author.id, author],
            [human.id, human],
          ])
        }
        comment={comment}
        mentionOptions={[human]}
        threadId="thread_1"
        threadStore={threadStore}
      />
    </QueryClientProvider>,
  );
}

describe("Document comment Markdown", () => {
  it("keeps failed edits available for retry and leaves editing only after success", async () => {
    const updateComment = vi
      .fn<TeamHubDocumentThreadStore["updateComment"]>()
      .mockRejectedValueOnce(new Error("Comment update failed"))
      .mockResolvedValue(undefined);
    renderComment("Published comment", updateComment);
    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const input = screen.getByRole("textbox", {
      name: "Edit comment by Reviewer",
    });
    fireEvent.change(input, {
      target: { value: "Revised comment with details that must not be lost." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Comment update failed",
    );
    expect(input).toHaveValue(
      "Revised comment with details that must not be lost.",
    );
    expect(input).not.toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(updateComment).toHaveBeenCalledTimes(2));
    expect(updateComment.mock.calls[1]).toEqual(updateComment.mock.calls[0]);
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Edit comment by Reviewer" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders Agent Markdown with the Room message renderer and retains structured mentions", () => {
    const { container } = renderComment(
      "@Alice **Check passed**\n\n- First item\n- Second item\n\n> A quote\n\n```ts\nconst ready = true;\n```\n\n| Item | Status |\n| --- | --- |\n| Review | Done |",
    );
    expect(screen.getByText("Check passed").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeVisible();
    expect(container.querySelector("blockquote")).toHaveTextContent("A quote");
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const ready = true;",
    );
    expect(container.querySelector("mark")).toHaveTextContent("@Alice");
  });

  it("keeps the existing safe Markdown boundary for comment links and raw HTML", () => {
    const { container } = renderComment(
      "[Safe link](https://example.com) [Unsafe](javascript:alert%281%29) <img src=x onerror=alert(1)>",
    );
    expect(screen.getByRole("link", { name: "Safe link" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(
      container
        .querySelector(".room-document-comment-body")
        ?.querySelector('a[href^="javascript:"], img, script'),
    ).toBeNull();
  });
});
