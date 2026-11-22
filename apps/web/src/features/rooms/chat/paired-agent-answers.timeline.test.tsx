import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { MessageTimeline } from "./message-timeline";

function message(
  id: string,
  authorId: string,
  kind: "agent" | "human",
  parentId: string | undefined,
  createdAt: string,
  text: string,
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorId,
      id: authorId,
      kind,
      tenant_id: "tenant-1",
    },
    created_at: createdAt,
    id,
    message_kind: "conversation",
    raw_message: text,
    room_id: "room-1",
    segments: [{ type: "text", content: text }],
    tenant_id: "tenant-1",
    ...(parentId ? { reply_to_message_id: parentId } : {}),
  };
}

function renderTimeline(messages: TeamHubMessage[]) {
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
          messages={messages}
          mentionableActorIds={new Set(messages.map((item) => item.author.id))}
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
          tenantId="tenant-1"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("two agents answering one message", () => {
  it("shows both answers together and leaves other answers apart", () => {
    renderTimeline([
      message(
        "ask",
        "human-1",
        "human",
        undefined,
        "2026-11-16T08:00:00.000Z",
        "What should we ship?",
      ),
      message(
        "codex",
        "agent-codex",
        "agent",
        "ask",
        "2026-11-16T08:01:00.000Z",
        "Ship the brief.",
      ),
      message(
        "lev",
        "agent-lev",
        "agent",
        "ask",
        "2026-11-16T08:40:00.000Z",
        "Ship the notes.",
      ),
      message(
        "other",
        "agent-other",
        "agent",
        "elsewhere",
        "2026-11-16T08:41:00.000Z",
        "A different answer.",
      ),
    ]);
    const pair = document.querySelector("[data-paired-answers='ask']");
    if (!pair) throw new Error("paired answers were not rendered");
    expect(
      [...pair.querySelectorAll("[data-message-id]")].map((row) =>
        row.getAttribute("data-message-id"),
      ),
    ).toEqual(["codex", "lev"]);
    expect(
      pair.compareDocumentPosition(screen.getByText("A different answer.")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      document.querySelector("[data-paired-answers='elsewhere']"),
    ).toBeNull();
  });

  it("keeps every message visible when a paired agent answer arrives within the same-moment window", () => {
    renderTimeline([
      message(
        "ask",
        "human-1",
        "human",
        undefined,
        "2026-11-16T08:00:00.000Z",
        "What is the status?",
      ),
      message(
        "agent-a-reply",
        "agent-a",
        "agent",
        "ask",
        "2026-11-16T08:00:02.000Z",
        "Agent A status update.",
      ),
      message(
        "agent-b-reply",
        "agent-b",
        "agent",
        "ask",
        "2026-11-16T08:00:05.000Z",
        "Agent B status update.",
      ),
    ]);

    expect(screen.getByText("What is the status?")).toBeVisible();
    expect(screen.getByText("Agent A status update.")).toBeVisible();
    expect(screen.getByText("Agent B status update.")).toBeVisible();
    const pair = document.querySelector("[data-paired-answers='ask']");
    expect(pair).not.toBeNull();
    expect(
      [...pair!.querySelectorAll("[data-message-id]")].map((row) =>
        row.getAttribute("data-message-id"),
      ),
    ).toEqual(["agent-a-reply", "agent-b-reply"]);
  });
});
