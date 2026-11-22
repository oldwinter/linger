import type { CommentData } from "@blocknote/core/comments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { formatDateTime } from "@/lib/date-format";
import { TeamHubTestServer } from "@/test/teamhub-test-server";

import { commentThreadResponse } from "./document-comment-test-data";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { commentBodyFromComposition } from "./room-document-comment-body";
import { RoomDocumentCommentRow } from "./room-document-comment-row";
import type { TeamHubDocumentThreadStore } from "./room-document-comments";

const comments = zhCN.documentComments;

describe("Document comments in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words the comments panel in Chinese and marks close and send", async () => {
    await setLanguage("zh-CN");
    const thread = commentThreadResponse("thread_language", "Review text");
    const server = new TeamHubTestServer().on(
      "GET",
      "/v0/documents/{documentId}/comment-threads",
      () => ({ items: [thread], page: { has_more: false } }),
    );
    const client = createHttpTeamHubClient({
      fetchRequest: server.fetch,
      onAuthenticationRequired: () => undefined,
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <DocumentCommentsPanel
          client={client}
          documentId="document_1"
          documentVersionId="version_1"
          onClose={() => undefined}
          open
          portalTarget={document.body}
          roomId="room_1"
          scopeId="room_1"
          tenantId="tenant_1"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Review text")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: comments.comments }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: comments.closeComments }),
    ).toHaveAttribute("data-voice-close");
    expect(screen.getByLabelText(comments.newComment)).toHaveAttribute(
      "placeholder",
      comments.addCommentPlaceholder,
    );
    expect(
      screen.getByRole("button", { name: comments.addComment }),
    ).toBeVisible();

    const threadView = screen.getByLabelText(
      comments.commentBy.replace("{name}", "Jenny"),
    );
    const date = formatDateTime(
      thread.created_at,
      { day: "numeric", month: "short" },
      "zh-CN",
    );
    expect(within(threadView).getByText(date)).toBeVisible();

    fireEvent.click(
      within(threadView).getByRole("button", { name: comments.reply }),
    );
    expect(await screen.findByLabelText(comments.replyToComment)).toBeVisible();
    expect(
      screen.getByRole("button", { name: comments.sendReply }),
    ).toHaveAttribute("data-voice-risk", "never");
  });

  it("words a comment row in Chinese and marks Delete", async () => {
    await setLanguage("zh-CN");
    const author: TeamHubActorRef = {
      display_name: "Reviewer",
      id: "agent-reviewer",
      kind: "agent",
      tenant_id: "tenant_1",
    };
    const comment: CommentData = {
      body: commentBodyFromComposition({
        body: "Looks good",
        files: [],
        mentions: [],
      }),
      createdAt: new Date("2026-09-20T00:00:00Z"),
      id: "comment_1",
      metadata: { author },
      reactions: [],
      type: "comment",
      updatedAt: new Date("2026-09-20T00:00:00Z"),
      userId: author.id,
    };
    const threadStore = {
      auth: {
        canAddReaction: () => false,
        canDeleteComment: () => true,
        canDeleteReaction: () => false,
        canUpdateComment: () => true,
      },
    } as unknown as TeamHubDocumentThreadStore;

    render(
      <RoomDocumentCommentRow
        actors={new Map([[author.id, author]])}
        comment={comment}
        mentionOptions={[]}
        threadId="thread_1"
        threadStore={threadStore}
      />,
    );

    expect(screen.getByText("Looks good")).toBeVisible();
    expect(
      screen.getByRole("button", { name: comments.editComment }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: comments.deleteComment }),
    ).toHaveAttribute("data-voice-risk", "never");
  });
});
