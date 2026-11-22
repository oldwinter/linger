import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createHttpTeamHubClient,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import {
  teamHubErrorResponse,
  TeamHubTestServer,
} from "@/test/teamhub-test-server";
import { DocumentCommentDraftGuard } from "./document-comment-draft-guard";
import { commentThreadResponse as threadFixture } from "./document-comment-test-data";

import { DocumentCommentsPanel } from "./document-comments-panel";

describe("Version Document Comments panel", () => {
  it("renders the selected excerpt as a reference without a filename or status tabs", async () => {
    const server = new TeamHubTestServer().on(
      "GET",
      "/v0/documents/{documentId}/comment-threads",
      () => ({
        items: [
          threadFixture(
            "thread_reference",
            "“Selected excerpt”\n\nReview text",
          ),
        ],
        page: { has_more: false },
      }),
    );
    renderPanel({ client: testClient(server) });
    expect(await screen.findByText("Selected excerpt")).toBeVisible();
    expect(screen.getByText("Review text")).toBeVisible();
    expect(screen.queryByText("review.pdf")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\d+ (Open|Resolved)/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeVisible();
  });

  it("renders Markdown in version comments using the message renderer", async () => {
    const server = new TeamHubTestServer().on(
      "GET",
      "/v0/documents/{documentId}/comment-threads",
      () => ({
        items: [
          threadFixture(
            "thread_markdown",
            "**Review passed**\n\n- Check again",
          ),
        ],
        page: { has_more: false },
      }),
    );
    renderPanel({ client: testClient(server) });
    expect((await screen.findByText("Review passed")).tagName).toBe("STRONG");
    expect(screen.getByRole("listitem")).toHaveTextContent("Check again");
  });

  it("submits a selected Version excerpt with Enter while preserving IME and Shift+Enter", async () => {
    const created = threadFixture("thread_selection", "Selected review");
    const createRoomDocumentCommentThread = vi.fn(() => created);
    const server = emptyThreadServer().on(
      "POST",
      "/v0/documents/{documentId}/comment-threads",
      createRoomDocumentCommentThread,
    );
    const onSelectionConsumed = vi.fn();
    renderPanel({
      client: testClient(server),
      onSelectionConsumed,
      selectionQuote: "selected paragraph",
    });
    const composer = await screen.findByLabelText("New Document comment");
    expect(screen.getByText("selected paragraph")).toBeVisible();
    fireEvent.change(composer, { target: { value: "Please revise this." } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    fireEvent.compositionStart(composer);
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.compositionEnd(composer);
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer, { key: "Enter", keyCode: 229 });
    expect(createRoomDocumentCommentThread).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() =>
      expect(createRoomDocumentCommentThread).toHaveBeenCalledOnce(),
    );
    expect(createRoomDocumentCommentThread).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { documentId: "document_1" },
        body: expect.objectContaining({
          document_version_id: "version_1",
          initial_comment: {
            segments: [
              {
                content: "“selected paragraph”\n\nPlease revise this.",
                type: "text",
              },
            ],
          },
        }),
      }),
    );
    expect(onSelectionConsumed).toHaveBeenCalledOnce();
  });

  it("keeps the whole-Document Comment draft when creation fails", async () => {
    const createRoomDocumentCommentThread = vi.fn(() =>
      teamHubErrorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "Comment service unavailable",
      ),
    );
    const server = emptyThreadServer().on(
      "POST",
      "/v0/documents/{documentId}/comment-threads",
      createRoomDocumentCommentThread,
    );
    renderPanel({ client: testClient(server) });

    const composer = await screen.findByLabelText("New Document comment");
    fireEvent.change(composer, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Comment service unavailable",
    );
    expect(composer).toHaveValue("Keep this draft");
    expect(screen.getByRole("button", { name: "Add comment" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() =>
      expect(createRoomDocumentCommentThread).toHaveBeenCalledTimes(2),
    );
  });

  it("protects unsent comment and reply drafts through DocumentCommentDraftGuard on close", async () => {
    const server = new TeamHubTestServer().on(
      "GET",
      "/v0/documents/{documentId}/comment-threads",
      () => ({
        items: [threadFixture("thread_guard", "Existing comment")],
        page: { has_more: false },
      }),
    );
    const onClose = vi.fn();
    renderGuardedPanel({ client: testClient(server), onClose });

    const composer = await screen.findByLabelText("New Document comment");
    fireEvent.change(composer, { target: { value: "Unsent file comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));

    const dialog = screen.getByRole("dialog", {
      name: "Discard comment drafts?",
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Continue editing" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Discard comment drafts?" }),
    ).toBeNull();
    expect(composer).toHaveValue("Unsent file comment");

    fireEvent.change(composer, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const reply = screen.getByLabelText("Reply to Document comment");
    fireEvent.change(reply, { target: { value: "Unsent reply draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));

    const replyDialog = screen.getByRole("dialog", {
      name: "Discard comment drafts?",
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      within(replyDialog).getByRole("button", { name: "Discard and close" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("complementary", { name: "All Document comments" }),
    ).toBeNull();
  });

  it("blocks closing while a comment request is pending and clears protection after submission", async () => {
    const created = threadFixture("thread_pending", "Saved comment");
    let finishCreate!: () => void;
    const response = new Promise<typeof created>((resolve) => {
      finishCreate = () => resolve(created);
    });
    const server = emptyThreadServer().on(
      "POST",
      "/v0/documents/{documentId}/comment-threads",
      () => response,
    );
    const onClose = vi.fn();
    renderGuardedPanel({ client: testClient(server), onClose });

    const composer = await screen.findByLabelText("New Document comment");
    fireEvent.change(composer, { target: { value: "Saved comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    const pendingDialog = screen.getByRole("dialog", {
      name: "Comment is still saving",
    });
    expect(
      within(pendingDialog).queryByRole("button", {
        name: "Discard and close",
      }),
    ).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finishCreate());
    await waitFor(() => expect(composer).toHaveValue(""));
    expect(
      screen.queryByRole("dialog", { name: "Comment is still saving" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function GuardedPanelHost({
  client,
  onClose,
}: {
  client: TeamHubClient;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <DocumentCommentDraftGuard>
      <DocumentCommentsPanel
        client={client}
        documentId="document_1"
        documentVersionId="version_1"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        open={open}
        portalTarget={document.body}
        roomId="room_1"
        scopeId="room_1"
        tenantId="tenant_1"
      />
    </DocumentCommentDraftGuard>
  );
}

function renderGuardedPanel({
  client,
  onClose,
}: {
  client: TeamHubClient;
  onClose: () => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GuardedPanelHost client={client} onClose={onClose} />
    </QueryClientProvider>,
  );
}

function renderPanel({
  client,
  onSelectionConsumed,
  selectionQuote,
}: {
  client: TeamHubClient;
  onSelectionConsumed?: () => void;
  selectionQuote?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentCommentsPanel
        client={client}
        documentId="document_1"
        documentVersionId="version_1"
        onClose={() => undefined}
        onSelectionConsumed={onSelectionConsumed}
        open
        portalTarget={document.body}
        roomId="room_1"
        scopeId="room_1"
        selectionQuote={selectionQuote}
        tenantId="tenant_1"
      />
    </QueryClientProvider>,
  );
}

function emptyThreadServer() {
  return new TeamHubTestServer().on(
    "GET",
    "/v0/documents/{documentId}/comment-threads",
    () => ({ items: [], page: { has_more: false } }),
  );
}

function testClient(server: TeamHubTestServer) {
  return createHttpTeamHubClient({
    fetchRequest: server.fetch,
    onAuthenticationRequired: () => undefined,
  });
}
