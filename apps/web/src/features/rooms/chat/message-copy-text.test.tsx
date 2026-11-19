import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineGlobalProperty } from "@/test/global-properties";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { MessageTimeline } from "./message-timeline";

const tenantId = "tenant-1";

describe("Copy message text", () => {
  beforeEach(() => {
    stubClipboard(() => Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the readable body and confirms it", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    renderTimeline("First line.\n\n- **Second** line.\n\n\n");

    openMenu("Copy text");

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("First line.\n\nSecond line.\n"),
    );
    await waitFor(() => expect(statusTexts()).toContain("Copied"));
    expect(
      screen.queryByRole("menuitem", { name: "Copy text" }),
    ).not.toBeInTheDocument();
  });

  it("keeps mention labels and link text as the reader sees them", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    renderTimeline(
      "Thanks @Casey Example, see [the runbook](https://example.com/runbook).",
    );

    openMenu("Copy text");

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Thanks @Casey Example, see the runbook.\n",
      ),
    );
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    defineGlobalProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    renderTimeline("A message worth copying.");

    openMenu("Copy text");

    await waitFor(() => expect(statusTexts()).toContain("Copy failed"));
    expect(statusTexts()).not.toContain("Copied");
  });
});

function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "More message actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

function statusTexts() {
  return screen.getAllByRole("status").map((status) => status.textContent);
}

function stubClipboard(writeText: () => Promise<void>) {
  const write = vi.fn(writeText);
  Object.assign(navigator, { clipboard: { writeText: write } });
  return write;
}

function renderTimeline(rawMessage: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <MessageTimeline
          canLoadOlder={false}
          currentActorId="human-1"
          loadingOlder={false}
          messages={[conversationMessage(rawMessage)]}
          onCancel={vi.fn()}
          onCardDecision={vi.fn()}
          onCloseLinkedSource={vi.fn()}
          onOpenArtifact={vi.fn()}
          onOpenMessageFile={vi.fn()}
          onOpenProfile={vi.fn()}
          onOpenThread={vi.fn()}
          onRetry={vi.fn()}
          pendingMessages={[]}
          presentations={{}}
          tenantId={tenantId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function conversationMessage(rawMessage: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Alice",
      id: "human-1",
      kind: "human",
      tenant_id: tenantId,
    },
    created_at: "2026-11-15T08:00:00Z",
    id: "message-copy-text",
    message_kind: "conversation",
    raw_message: rawMessage,
    room_id: "room-all",
    segments: [{ content: rawMessage, type: "text" }],
    tenant_id: tenantId,
  };
}
