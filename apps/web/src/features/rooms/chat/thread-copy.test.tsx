import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { ThreadCopyAction } from "./thread-copy";

const tenantId = "tenant-1";

describe("ThreadCopyAction", () => {
  beforeEach(() => {
    stubClipboard(() => Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the Thread as Markdown in display order", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(
      <ThreadCopyAction
        actorDisplayNames={{ "human-1": "Ada Lovelace" }}
        messages={[
          message(
            "human-1",
            "Alice",
            "2026-11-14T09:12:00",
            "First line.\n\n- **Second** line.",
          ),
          message(
            "human-2",
            "Casey Example",
            "2026-11-14T09:20:00",
            "A reply.",
          ),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy thread" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Thread",
          "**Ada Lovelace, 2026-11-14 09:12**\nFirst line.\n\nSecond line.",
          "**Casey Example, 2026-11-14 09:20**\nA reply.",
        ].join("\n\n"),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  });

  it("stays disabled while the Thread has no messages", () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<ThreadCopyAction actorDisplayNames={{}} messages={[]} />);

    const copy = screen.getByRole("button", { name: "Copy thread" });
    expect(copy).toBeDisabled();
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    render(
      <ThreadCopyAction
        actorDisplayNames={{}}
        messages={[
          message("agent-1", "Codex", "2026-11-14T09:12:00", "Handled."),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy thread" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Copy failed"),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

function stubClipboard(writeText: () => Promise<void>) {
  const write = vi.fn(writeText);
  Object.assign(navigator, { clipboard: { writeText: write } });
  return write;
}

function message(
  authorId: string,
  authorName: string,
  createdAt: string,
  body: string,
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorName,
      id: authorId,
      kind: "human",
      tenant_id: tenantId,
    },
    created_at: createdAt,
    id: `message-${authorId}`,
    message_kind: "conversation",
    raw_message: body,
    room_id: "room-thread",
    segments: [{ content: body, type: "text" }],
    tenant_id: tenantId,
  };
}
