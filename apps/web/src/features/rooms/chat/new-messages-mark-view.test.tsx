import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { MessageTimeline } from "./message-timeline";

function message(id: string, authorId: string, text: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorId === "me" ? "Ada" : "Codex",
      id: authorId,
      kind: authorId === "me" ? "human" : "agent",
      tenant_id: "tenant-1",
    },
    created_at: `2026-11-14T10:0${id}:00Z`,
    id,
    message_kind: "conversation",
    raw_message: text,
    room_id: "room-1",
    segments: [{ content: text, type: "text" }],
    tenant_id: "tenant-1",
  };
}

describe("New messages mark", () => {
  it("draws the mark above the unread Messages and not above the reader's own", () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <MessageTimeline
            canLoadOlder={false}
            currentActorId="me"
            loadingOlder={false}
            messages={[
              message("1", "ada", "Earlier"),
              message("2", "me", "My note"),
              message("3", "ada", "The launch moved"),
            ]}
            onCancel={() => undefined}
            onCardDecision={() => undefined}
            onCloseLinkedSource={() => undefined}
            onOpenArtifact={() => undefined}
            onOpenMessageFile={async () => undefined}
            onOpenProfile={() => undefined}
            onRetry={() => undefined}
            openedUnreadCount={1}
            pendingMessages={[]}
            presentations={{}}
            tenantId="tenant-1"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const mark = screen.getByRole("separator", { name: "1 new message" });
    const unread = screen.getByText("The launch moved");
    expect(
      mark.compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      mark.compareDocumentPosition(screen.getByText("My note")) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });
});
