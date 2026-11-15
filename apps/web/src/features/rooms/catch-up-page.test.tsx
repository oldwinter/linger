import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { CatchUpPage } from "./catch-up-page";
import { readCatchUpWalk } from "./catch-up";

afterEach(() => {
  window.sessionStorage.clear();
});

function room(
  id: string,
  name: string,
  unreadMessages: number,
  preview = "",
): TeamHubRoomListItem {
  return {
    created_at: "2026-07-24T09:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    id,
    kind: "room",
    latest_message: preview
      ? {
          author: {
            display_name: "Mina",
            id: "actor-mina",
            kind: "human",
            tenant_id: "tenant-northstar",
          },
          created_at: "2026-07-24T10:00:00Z",
          id: `message-${id}`,
          raw_message: preview,
          room_seq: 2,
        }
      : undefined,
    latest_room_seq: 2,
    name,
    read_through_room_seq: unreadMessages ? 1 : 2,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: unreadMessages,
    updated_at: "2026-07-24T10:00:00Z",
  };
}

function renderPage(items: TeamHubRoomListItem[]) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/rooms", () => ({
    items,
    page: { has_more: false },
  }));
  const router = createMemoryRouter(
    [
      {
        element: <CatchUpPage />,
        path: "/t/:tenantId/rooms/catch-up",
      },
      {
        element: <div>Chat</div>,
        path: "/t/:tenantId/rooms/:roomId/chat",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/rooms/catch-up"] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("Catch up", () => {
  it("walks the frozen chats and still has them after their badges would clear", async () => {
    const router = renderPage([
      room("room-notes", "Notes", 2, "Ship the brief"),
      room("room-launch", "Launch", 1, "Call Mom"),
      room("room-quiet", "Quiet", 0),
    ]);

    expect(await screen.findByRole("heading", { name: "Notes" })).toBeVisible();
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.getByText("Ship the brief")).toBeVisible();
    expect(screen.getByText("2 new messages when you started")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-notes/chat",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Launch" })).toBeVisible();
    expect(screen.getByText("2 of 2")).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Open" }));
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-launch/chat",
    );
    expect(
      readCatchUpWalk("account-jenny", "tenant-northstar")?.rooms.map(
        (item) => item.name,
      ),
    ).toEqual(["Notes", "Launch"]);

    renderPage([
      room("room-notes", "Notes", 0),
      room("room-launch", "Launch", 0),
    ]);
    expect(
      await screen.findByRole("heading", { name: "Launch" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByRole("heading", { name: "You're caught up" }),
    ).toBeVisible();
    expect(screen.getByText("You walked 2 chats.")).toBeVisible();
    expect(screen.getByText("Notes")).toBeVisible();
  });

  it("says there is nothing new when no chat is waiting", async () => {
    renderPage([room("room-quiet", "Quiet", 0)]);
    expect(
      await screen.findByRole("heading", { name: "You're caught up" }),
    ).toBeVisible();
    expect(screen.getByText("No chats have new messages.")).toBeVisible();
  });
});
