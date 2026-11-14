import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { MessageTimeline } from "../chat/message-timeline";

function message(): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Codex",
      id: "agent-1",
      kind: "agent",
      tenant_id: "tenant-1",
    },
    created_at: "2026-11-14T08:00:00Z",
    id: "message-1",
    message_kind: "conversation",
    raw_message: "The launch is Thursday.",
    room_id: "room-1",
    segments: [{ content: "The launch is Thursday.", type: "text" }],
    tenant_id: "tenant-1",
  };
}

describe("Save to Pocket", () => {
  it("appends the message onto today's Pocket Note", async () => {
    const runtime = createTestTeamHubRuntime();
    const note = {
      date: "2026-11-14",
      text: "Buy milk",
      updated_at: "2026-11-14T00:00:00Z",
    };
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
      items: [note],
      page: { has_more: false },
      today: "2026-11-14",
    }));
    runtime.server.on(
      "PUT",
      "/v0/tenants/{tenantId}/me/pocket-notes/today",
      ({ body }) => {
        expect(body).toEqual({
          text: "Buy milk\nCodex: The launch is Thursday.",
        });
        return {
          ...note,
          text: "Buy milk\nCodex: The launch is Thursday.",
          updated_at: "2026-11-14T08:01:00Z",
        };
      },
    );
    const item = message();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <MemoryRouter>
            <MessageTimeline
              canLoadOlder={false}
              currentActorId="human-1"
              loadingOlder={false}
              messages={[item]}
              onCancel={() => undefined}
              onCardDecision={() => undefined}
              onCloseLinkedSource={() => undefined}
              onOpenArtifact={() => undefined}
              onOpenMessageFile={async () => undefined}
              onOpenProfile={() => undefined}
              onRetry={() => undefined}
              pendingMessages={[]}
              presentations={{}}
              tenantId="tenant-1"
            />
          </MemoryRouter>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    const row = screen.getByText(item.raw_message).closest("article")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "More message actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Save to Pocket" }));
    await waitFor(() => {
      expect(
        runtime.server.requestsTo(
          "PUT",
          "/v0/tenants/{tenantId}/me/pocket-notes/today",
        ),
      ).toHaveLength(1);
    });
    fireEvent.click(
      within(row).getByRole("button", { name: "More message actions" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Saved to Pocket" }),
    ).toBeDisabled();
  });
});
