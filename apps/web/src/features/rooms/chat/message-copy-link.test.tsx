import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { MessageTimeline } from "./message-timeline";

const tenantId = "tenant-1";

describe("Copy message link", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies a link that opens the Message in its Room", async () => {
    renderTimeline(conversationMessage("message-alpha", "room-all"));

    fireEvent.click(
      screen.getByRole("button", { name: "More message actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/t/tenant-1/rooms/room-all/chat?message=message-alpha`,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("tooltip").map((tooltip) => tooltip.textContent),
      ).toContain("Copied"),
    );
  });

  it("copies a thread link for a Message inside a thread", async () => {
    renderTimeline(conversationMessage("message-reply", "room-thread-7"));

    fireEvent.click(
      screen.getByRole("button", { name: "More message actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/t/tenant-1/rooms/room-thread-7/chat?message=message-reply`,
      ),
    );
  });
});

function renderTimeline(message: TeamHubMessage) {
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
          messages={[message]}
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

function conversationMessage(id: string, roomId: string): TeamHubMessage {
  const content = "A message worth linking.";
  return {
    attachments: [],
    author: {
      display_name: "Alice",
      id: "human-1",
      kind: "human",
      tenant_id: tenantId,
    },
    created_at: "2026-11-15T08:00:00Z",
    id,
    message_kind: "conversation",
    raw_message: content,
    room_id: roomId,
    segments: [{ content, type: "text" }],
    tenant_id: tenantId,
  };
}
