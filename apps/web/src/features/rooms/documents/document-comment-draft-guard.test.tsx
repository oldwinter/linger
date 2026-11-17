import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentCommentDraftGuard,
  useDocumentCommentsClose,
} from "./document-comment-draft-guard";
import { DocumentMentionMessageComposer } from "./room-document-comment-composer";

describe("Document comment draft dismissal", () => {
  it("closes a clean composer and treats its initial edit text as unchanged", () => {
    renderComments({ initialValue: "An existing comment" });

    fireEvent.click(screen.getByRole("button", { name: "Comments" }));

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("protects a reply from the parent Comments toggle and restores its input focus", async () => {
    renderComments();
    const input = screen.getByRole("textbox", {
      name: "Reply to Document comment",
    });
    fireEvent.change(input, { target: { value: "Retain this review reply." } });
    input.focus();

    fireEvent.click(screen.getByRole("button", { name: "Comments" }));

    const confirmation = screen.getByRole("dialog", {
      name: "Discard comment drafts?",
    });
    expect(
      within(confirmation).getByRole("button", { name: "Continue editing" }),
    ).toHaveFocus();
    fireEvent(
      confirmation,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(input).toHaveValue("Retain this review reply.");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole("complementary")).toBeVisible();
  });

  it("blocks close and repeat send while pending, retains a failed reply, and clears protection after success", async () => {
    const response = deferred();
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(() => response.promise)
      .mockResolvedValue(undefined);
    renderComments({ onSubmit });
    const input = screen.getByRole("textbox", {
      name: "Reply to Document comment",
    });
    fireEvent.change(input, {
      target: { value: "Retain the reply when the request fails." },
    });

    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const pending = screen.getByRole("dialog", {
      name: "Comment is still saving",
    });
    expect(
      within(pending).queryByRole("button", { name: "Discard and close" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeVisible();
    expect(input).toHaveAttribute("readonly");

    await act(async () => response.reject(new Error("Comment request failed")));

    expect(
      screen.queryByRole("dialog", { name: "Comment is still saving" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Comment request failed",
    );
    expect(input).not.toHaveAttribute("readonly");
    expect(input).toHaveValue("Retain the reply when the request fails.");
    fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Comments" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("removes a departed composer's protection even when its request settles later", async () => {
    const response = deferred();
    const onSubmit = vi.fn(() => response.promise);
    const view = renderComments({ onSubmit });
    const input = screen.getByRole("textbox", {
      name: "Reply to Document comment",
    });
    fireEvent.change(input, {
      target: { value: "A reply on another thread." },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    view.setComposerVisible(false);
    await act(async () => response.reject(new Error("Late request failure")));
    fireEvent.click(screen.getByRole("button", { name: "Comments" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("allows retry when submitting throws before it returns a promise", async () => {
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Comment could not be prepared");
      })
      .mockResolvedValue(undefined);
    renderComments({ onSubmit });
    const input = screen.getByRole("textbox", {
      name: "Reply to Document comment",
    });
    fireEvent.change(input, { target: { value: "Keep this prepared reply." } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Comment could not be prepared",
    );
    expect(input).toHaveValue("Keep this prepared reply.");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function renderComments({
  initialValue,
  onSubmit = vi.fn().mockResolvedValue(undefined),
}: {
  initialValue?: string;
  onSubmit?: () => Promise<void>;
} = {}) {
  const client = new QueryClient();
  const view = (showComposer: boolean) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <DocumentCommentDraftGuard>
          <Comments
            initialValue={initialValue}
            onSubmit={onSubmit}
            showComposer={showComposer}
          />
        </DocumentCommentDraftGuard>
      </QueryClientProvider>
    </StrictMode>
  );
  const rendered = render(view(true));
  return {
    setComposerVisible: (visible: boolean) => rendered.rerender(view(visible)),
  };
}

function Comments({
  initialValue,
  onSubmit,
  showComposer,
}: {
  initialValue?: string;
  onSubmit: () => Promise<void>;
  showComposer: boolean;
}) {
  const [open, setOpen] = useState(true);
  const requestClose = useDocumentCommentsClose();
  return (
    <>
      <button
        onClick={() => {
          if (open) requestClose(() => setOpen(false));
          else setOpen(true);
        }}
        type="button"
      >
        Comments
      </button>
      {open ? (
        <aside aria-label="All Document comments">
          {showComposer ? (
            <DocumentMentionMessageComposer
              ariaLabel="Reply to Document comment"
              initialValue={initialValue}
              mentionOptions={[]}
              onSubmit={onSubmit}
            />
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function deferred() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}
