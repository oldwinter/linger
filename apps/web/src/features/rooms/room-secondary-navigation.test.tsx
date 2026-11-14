import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as renderInDocument,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubAnotherMe,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";
import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import { TeamHubTestServer } from "@/test/teamhub-test-server";

import * as avatarImages from "./members/actor-avatar-image";
import { writeRoomComposerDraft, type RoomComposerDraft } from "./room-drafts";
import { RoomSecondaryNavigation } from "./room-secondary-navigation";
import { ROOM_SNOOZE_HOUR_MS } from "./room-snooze";

/** Row actions read the Room list cache and the runtime client. */
function NavigationProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        {children}
      </TeamHubRuntimeProvider>
    </QueryClientProvider>
  );
}

function render(ui: ReactElement) {
  return renderInDocument(ui, { wrapper: NavigationProviders });
}

describe("RoomSecondaryNavigation attention", () => {
  it("shows the away recap above the Room rows", () => {
    localStorage.removeItem("away-recap-dismissed.v1:account-a:tenant-a");
    render(
      <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
        <Routes>
          <Route
            element={
              <RoomSecondaryNavigation
                accountId="account-a"
                activeRoomId="room-active"
                onCloseMobile={() => undefined}
                onCreateRoom={() => undefined}
                rooms={[room("room-active", 4, 2), room("room-waiting", 3, 1)]}
                tenant={{
                  created_at: "2026-07-24T09:00:00Z",
                  id: "tenant-a",
                  name: "Northstar",
                }}
              />
            }
            path="/t/:tenantId/rooms/:roomId/chat"
          />
        </Routes>
      </MemoryRouter>,
    );

    const recap = screen.getByRole("region", { name: "While you were away" });
    expect(recap).toHaveTextContent("3 new messages in 1 room, 1 mention");
    const messages = screen
      .getByRole("heading", { name: "Messages" })
      .closest("section")!;
    expect(
      recap.compareDocumentPosition(messages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows newly created Agents and Rooms first after updates and reloads", () => {
    const olderRoom = {
      ...room("older-room", 0, 0),
      updated_at: "2026-07-26T09:00:00Z",
    };
    const newerRoom = {
      ...room("newer-room", 0, 0),
      created_at: "2026-07-25T09:00:00Z",
    };
    const olderAgent = {
      ...deletedDirectRoom(),
      id: "older-agent",
      direct_peer_active: true,
      updated_at: olderRoom.updated_at,
      name: "Older Agent",
      direct_peer: {
        ...deletedDirectRoom().direct_peer!,
        display_name: "Older Agent",
      },
    };
    const newerAgent = {
      ...olderAgent,
      id: "newer-agent",
      name: "Newer Agent",
      created_at: newerRoom.created_at,
      direct_peer: { ...olderAgent.direct_peer, display_name: "Newer Agent" },
    };
    const anotherMe = { ...olderAgent, id: "another-me", name: "Another Me" };
    const initialRooms = [anotherMe, olderAgent, olderRoom];
    const updatedRooms = [...initialRooms, newerAgent, newerRoom];
    const navigation = (rooms: TeamHubRoomListItem[]) => (
      <MemoryRouter>
        <RoomSecondaryNavigation
          anotherMeRoomId="another-me"
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={rooms}
          tenant={{
            id: "tenant-a",
            name: "Northstar",
            created_at: olderRoom.created_at,
          }}
        />
      </MemoryRouter>
    );
    const assertOrder = () => {
      const links = screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(links).toEqual(
        [
          "another-me",
          "newer-agent",
          "newer-room",
          "older-agent",
          "older-room",
        ].map((id) => `/t/tenant-a/rooms/${id}/chat`),
      );
    };
    const view = render(navigation(initialRooms));
    view.rerender(navigation(updatedRooms));
    assertOrder();
    expect(updatedRooms.map((item) => item.id)).toEqual([
      "another-me",
      "older-agent",
      "older-room",
      "newer-agent",
      "newer-room",
    ]);
    view.unmount();
    render(navigation(updatedRooms));
    assertOrder();
  });

  it("puts capture tools and Search in the header row and a plus beside AGENTS and ROOMS", () => {
    const queryClient = new QueryClient();
    const onCreateRoom = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={liveRuntime()}>
          <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
            <Routes>
              <Route
                element={
                  <RoomSecondaryNavigation
                    onCloseMobile={() => undefined}
                    onCreateRoom={onCreateRoom}
                    rooms={[room("room-active", 0, 0)]}
                    tenant={{
                      created_at: "2026-07-24T09:00:00Z",
                      id: "tenant-a",
                      name: "Northstar",
                    }}
                  />
                }
                path="/t/:tenantId/rooms/:roomId/chat"
              />
            </Routes>
          </MemoryRouter>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    const quickAccess = screen.getByLabelText("Quick access");
    expect(
      within(quickAccess).getByRole("button", { name: "Pocket Notes" }),
    ).toBeVisible();
    expect(
      within(quickAccess).getByRole("button", { name: "Meetings" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Search" })).toBeVisible();
    const chats = screen
      .getByRole("button", { name: "Messages" })
      .closest("section")!;
    fireEvent.click(within(chats).getByRole("button", { name: "Create chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create Room" }));
    expect(onCreateRoom).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("textbox", { name: "Search Rooms" }),
    ).not.toBeInTheDocument();
  });

  it("opens Local Agent setup from Create Agent without navigating away", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={liveRuntime()}>
          <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
            <RoomSecondaryNavigation
              onCloseMobile={() => undefined}
              onCreateRoom={() => undefined}
              rooms={[room("room-active", 0, 0)]}
              tenant={{
                created_at: "2026-07-24T09:00:00Z",
                id: "tenant-a",
                name: "Northstar",
              }}
            />
          </MemoryRouter>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create Agent" }));

    expect(
      await screen.findByRole("dialog", { name: "Create local agent" }),
    ).toBeVisible();
    expect(screen.queryByText("/t/tenant-a/agents/new?type=local")).toBeNull();
  });

  it("uses one compact badge and gives Mentions priority", () => {
    render(
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
          <Routes>
            <Route
              element={
                <RoomSecondaryNavigation
                  onCloseMobile={() => undefined}
                  onCreateRoom={() => undefined}
                  rooms={[
                    room("room-active", 0, 0),
                    room("room-mentioned", 3, 1),
                  ]}
                  tenant={{
                    created_at: "2026-07-24T09:00:00Z",
                    id: "tenant-a",
                    name: "Northstar",
                  }}
                />
              }
              path="/t/:tenantId/rooms/:roomId/chat"
            />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>,
    );

    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    expect(
      screen.queryByLabelText("3 unread messages"),
    ).not.toBeInTheDocument();
  });

  it("keeps a Mention visible when the Room has no unread Messages", () => {
    render(
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
          <Routes>
            <Route
              element={
                <RoomSecondaryNavigation
                  onCloseMobile={() => undefined}
                  onCreateRoom={() => undefined}
                  rooms={[
                    room("room-active", 0, 0),
                    room("room-mentioned", 0, 1),
                  ]}
                  tenant={{
                    created_at: "2026-07-24T09:00:00Z",
                    id: "tenant-a",
                    name: "Northstar",
                  }}
                />
              }
              path="/t/:tenantId/rooms/:roomId/chat"
            />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>,
    );

    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument();
  });

  it("leaves Thread Rooms out of the Room navigation", () => {
    const anotherMe = {
      ...deletedDirectRoom(),
      direct_peer_active: true,
      name: "Another Me",
    };
    const agentDirect = {
      ...deletedDirectRoom(),
      direct_peer: {
        display_name: "118 Service",
        id: "actor-118",
        kind: "agent" as const,
        tenant_id: "tenant-a",
      },
      direct_peer_active: true,
      id: "room-agent-118",
      name: "118 Service",
    };

    render(
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-thread/chat"]}>
          <Routes>
            <Route
              element={
                <RoomSecondaryNavigation
                  activeRoomId="room-thread"
                  anotherMeRoomId={anotherMe.id}
                  onCloseMobile={() => undefined}
                  onCreateRoom={() => undefined}
                  rooms={[
                    anotherMe,
                    agentDirect,
                    room("room-active", 0, 0),
                    {
                      ...room("room-thread", 1, 0),
                      kind: "thread",
                      name: "Checklist thread",
                      parent_room_id: "room-active",
                      root_message_id: "message-2",
                    },
                    {
                      ...room("room-direct-thread", 2, 0),
                      kind: "thread",
                      name: "Workflow discussion",
                      parent_room_id: anotherMe.id,
                      root_message_id: "message-workflow-card",
                    },
                    {
                      ...room("room-agent-thread", 3, 0),
                      kind: "thread",
                      name: "118 Service Thread",
                      parent_room_id: agentDirect.id,
                      root_message_id: "message-agent-thread",
                    },
                  ]}
                  tenant={{
                    created_at: "2026-07-24T09:00:00Z",
                    id: "tenant-a",
                    name: "Northstar",
                  }}
                />
              }
              path="/t/:tenantId/rooms/:roomId/chat"
            />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>,
    );

    expect(screen.getByRole("link", { name: "room-active" })).toBeVisible();
    expect(screen.getByRole("link", { name: "118 Service" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Checklist thread" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Workflow discussion" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "118 Service Thread" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/unread message/)).not.toBeInTheDocument();
  });

  it("marks a deleted Agent beside its retained Direct Room", () => {
    render(
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-direct/chat"]}>
          <Routes>
            <Route
              element={
                <RoomSecondaryNavigation
                  onCloseMobile={() => undefined}
                  onCreateRoom={() => undefined}
                  rooms={[deletedDirectRoom()]}
                  tenant={{
                    created_at: "2026-07-24T09:00:00Z",
                    id: "tenant-a",
                    name: "Northstar",
                  }}
                />
              }
              path="/t/:tenantId/rooms/:roomId/chat"
            />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>,
    );

    expect(screen.getByRole("link", { name: "Codex, Deleted" })).toBeVisible();
  });

  it("lists parent Rooms but keeps thread Rooms out of the sidebar", () => {
    render(
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
        <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
          <Routes>
            <Route
              element={
                <RoomSecondaryNavigation
                  activeRoomId="room-active"
                  onCloseMobile={() => undefined}
                  onCreateRoom={() => undefined}
                  rooms={[
                    room("room-active", 0, 0),
                    room("room-other", 0, 0),
                    {
                      ...room("room-thread", 0, 0),
                      kind: "thread",
                      name: "Release discussion",
                      parent_room_id: "room-active",
                      root_message_id: "message-1",
                    },
                  ]}
                  tenant={{
                    created_at: "2026-07-24T09:00:00Z",
                    id: "tenant-a",
                    name: "Northstar",
                  }}
                />
              }
              path="/t/:tenantId/rooms/:roomId/chat"
            />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>,
    );

    expect(screen.getByRole("link", { name: "room-active" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "room-other" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Release discussion" }),
    ).not.toBeInTheDocument();
  });
});

function deletedDirectRoom(): TeamHubRoomListItem {
  return {
    ...room("room-direct", 0, 0),
    direct_peer: {
      display_name: "Codex",
      id: "actor-codex",
      kind: "agent",
      tenant_id: "tenant-a",
    },
    direct_peer_active: false,
    kind: "direct",
    name: "Codex",
  };
}

function room(
  id: string,
  unreadMessageCount: number,
  unreadMentionCount: number,
): TeamHubRoomListItem {
  return {
    created_at: "2026-07-24T09:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    id,
    kind: "room",
    latest_room_seq: 4,
    name: id,
    read_through_room_seq: unreadMessageCount ? 1 : 4,
    tenant_id: "tenant-a",
    unread_mention_count: unreadMentionCount,
    unread_message_count: unreadMessageCount,
    updated_at: "2026-07-24T10:00:00Z",
  };
}

function liveRuntime(): TeamHubRuntime {
  return {
    client: {} as TeamHubRuntime["client"],
    runStatuses: {} as TeamHubRuntime["runStatuses"],
    events: {} as TeamHubRuntime["events"],
  };
}

describe("Room navigation working indicator", () => {
  it("shows activity only for its Room, keeps unread badges, and clears on completion", () => {
    const group = room("room-working", 2, 1);
    const direct = { ...deletedDirectRoom(), direct_peer_active: true };
    const renderNavigation = (runningRoomIds: readonly string[]) => (
      <MemoryRouter>
        <RoomSecondaryNavigation
          activeRoomId={group.id}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={[group, direct, room("room-idle", 0, 0)]}
          runningRoomIds={runningRoomIds}
          tenant={{
            id: "tenant-a",
            name: "Northstar",
            created_at: "2026-07-24T09:00:00Z",
          }}
        />
      </MemoryRouter>
    );
    const { rerender } = render(renderNavigation([group.id, direct.id]));
    for (const name of [group.name, "Codex"]) {
      expect(
        within(screen.getByRole("link", { name })).getByRole("img", {
          name: "Agent working",
        }),
      ).toBeVisible();
    }
    expect(
      within(screen.getByRole("link", { name: "room-idle" })).queryByRole(
        "img",
        { name: "Agent working" },
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    rerender(renderNavigation([direct.id]));
    expect(
      within(screen.getByRole("link", { name: group.name })).queryByRole(
        "img",
        { name: "Agent working" },
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Agent working" })).toBeVisible();
    rerender(renderNavigation([]));
    expect(
      screen.queryByRole("img", { name: "Agent working" }),
    ).not.toBeInTheDocument();
  });

  it("shows a failed mark that yields to a working spinner", () => {
    const group = room("room-failed", 1, 0);
    const renderNavigation = (
      runningRoomIds: readonly string[],
      failedRoomIds: readonly string[] = [],
    ) => (
      <MemoryRouter>
        <RoomSecondaryNavigation
          activeRoomId={group.id}
          failedRoomIds={failedRoomIds}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={[group, room("room-idle", 0, 0)]}
          runningRoomIds={runningRoomIds}
          tenant={{
            id: "tenant-a",
            name: "Northstar",
            created_at: "2026-07-24T09:00:00Z",
          }}
        />
      </MemoryRouter>
    );
    const { rerender } = render(renderNavigation([], [group.id]));
    expect(
      within(screen.getByRole("link", { name: group.name })).getByRole("img", {
        name: "Last run failed",
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("link", { name: "room-idle" })).queryByRole(
        "img",
        { name: "Last run failed" },
      ),
    ).not.toBeInTheDocument();
    rerender(renderNavigation([group.id], [group.id]));
    expect(
      within(screen.getByRole("link", { name: group.name })).getByRole("img", {
        name: "Agent working",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("img", { name: "Last run failed" }),
    ).not.toBeInTheDocument();
  });
});

describe("Another Me card", () => {
  it.each([
    ["FFFFFF", "#1a1a16", "0.82"],
    ["8DA488", "#1a1a16", "1"],
    ["010101", "#fff", "0.82"],
    ["777777", "#1a1a16", "1"],
    ["6E3CED", "#fff", "1"],
  ])("keeps text readable on avatar background %s", (color, text, opacity) => {
    const record = vi
      .spyOn(avatarImages, "useAgentAvatarRecord")
      .mockReturnValue({ avatarKey: `figure:lion:${color}` });
    try {
      const anotherMe = { ...deletedDirectRoom(), direct_peer_active: true };
      render(
        <MemoryRouter>
          <RoomSecondaryNavigation
            activeRoomId={anotherMe.id}
            anotherMeRoomId={anotherMe.id}
            onCloseMobile={() => undefined}
            onCreateRoom={() => undefined}
            rooms={[anotherMe]}
            tenant={{
              id: "tenant-a",
              name: "Northstar",
              created_at: anotherMe.created_at,
            }}
          />
        </MemoryRouter>,
      );
      const card = screen.getByRole("link", {
        name: "Another Me Chat",
      }).parentElement!;
      expect(card.style.getPropertyValue("--am-brand")).toBe(`#${color}`);
      expect(card.style.getPropertyValue("--am-text")).toBe(text);
      expect(card.style.getPropertyValue("--am-sub-opacity")).toBe(opacity);
    } finally {
      record.mockRestore();
    }
  });

  it("fills the current card with the Agent's colour and keeps the working and failed icons", () => {
    const anotherMe = {
      ...deletedDirectRoom(),
      direct_peer: {
        display_name: "Jenny's Delegate",
        id: "actor-another-me",
        kind: "agent" as const,
        tenant_id: "tenant-a",
      },
      direct_peer_active: true,
      id: "room-another-me",
      name: "Jenny's Delegate",
    };
    const renderCard = (state: {
      running?: string[];
      failed?: string[];
      active?: boolean;
    }) => (
      <MemoryRouter>
        <RoomSecondaryNavigation
          activeRoomId={state.active ? anotherMe.id : "room-other"}
          anotherMeRoomId={anotherMe.id}
          failedRoomIds={state.failed ?? []}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={[anotherMe, room("room-other", 0, 0)]}
          runningRoomIds={state.running ?? []}
          tenant={{
            id: "tenant-a",
            name: "Northstar",
            created_at: "2026-07-24T09:00:00Z",
          }}
        />
      </MemoryRouter>
    );
    const card = () => screen.getByRole("link", { name: "Another Me Chat" });

    const { rerender } = render(renderCard({ running: [anotherMe.id] }));
    expect(card().parentElement).not.toHaveAttribute("data-active");
    // The card glows and fills with the Agent's avatar background colour.
    expect(card().parentElement!.style.getPropertyValue("--am-brand")).toMatch(
      /^#[0-9A-F]{6}$/,
    );
    expect(
      within(card()).getByRole("img", { name: "Agent working" }),
    ).toBeVisible();

    rerender(renderCard({ active: true, failed: [anotherMe.id] }));
    expect(card().parentElement).toHaveAttribute("data-active", "true");
    expect(
      within(card()).getByRole("img", { name: "Last run failed" }),
    ).toBeVisible();
  });
});

describe("Another Me before its Computer connects", () => {
  function renderWithAnotherMe(
    anotherMe: TeamHubAnotherMe,
    rooms: TeamHubRoomListItem[] = [],
  ) {
    renderInDocument(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={liveRuntime()}>
          <MemoryRouter>
            <RoomSecondaryNavigation
              anotherMeRoomId={anotherMe.room_id}
              onCloseMobile={() => undefined}
              onCreateRoom={() => undefined}
              rooms={rooms}
              tenant={{
                id: "tenant-a",
                name: "Northstar",
                created_at: "2026-07-24T09:00:00Z",
              }}
            />
          </MemoryRouter>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
  }

  it("shows no Another Me until it exists", () => {
    renderWithAnotherMe({});
    expect(screen.queryByRole("link", { name: "Another Me Chat" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the Another Me card once it exists", () => {
    const anotherMe = { ...deletedDirectRoom(), direct_peer_active: true };
    renderWithAnotherMe(
      { agent_actor_id: anotherMe.direct_peer!.id, room_id: anotherMe.id },
      [anotherMe],
    );
    expect(screen.getByRole("link", { name: "Another Me Chat" })).toBeVisible();
  });
});

describe("Room navigation pins", () => {
  function renderPinnedNavigation(
    rooms: TeamHubRoomListItem[],
    // Identity and Agent reads fail unless a test routes them, which leaves
    // Agent deletion unavailable.
    server = new TeamHubTestServer().allowUnhandledRoutes(),
  ) {
    const updateRoomPin = vi.fn((roomId: string, pinned: boolean) => ({
      room_id: roomId,
      ...(pinned ? { pinned_at: "2026-07-25T00:00:00Z" } : {}),
    }));
    server.on("PUT", "/v0/rooms/{roomId}/pin", ({ body, params }) =>
      updateRoomPin(params.roomId!, (body as { pinned: boolean }).pinned),
    );
    const runtime = {
      ...liveRuntime(),
      client: createHttpTeamHubClient({
        fetchRequest: server.fetch,
        onAuthenticationRequired: () => undefined,
      }),
    };
    renderInDocument(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <MemoryRouter>
            <RoomSecondaryNavigation
              onCloseMobile={() => undefined}
              onCreateRoom={() => undefined}
              rooms={rooms}
              tenant={{
                id: "tenant-a",
                name: "Northstar",
                created_at: "2026-07-24T09:00:00Z",
              }}
            />
          </MemoryRouter>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    return updateRoomPin;
  }

  it("leads each section with pinned chats, the most recently pinned first", () => {
    const agent = {
      ...deletedDirectRoom(),
      direct_peer_active: true,
      pinned_at: "2026-07-01T00:00:00Z",
    };
    const otherAgent = {
      ...agent,
      direct_peer: { ...agent.direct_peer!, display_name: "Claude" },
      id: "room-claude",
      name: "Claude",
      pinned_at: undefined,
    };
    renderPinnedNavigation([
      room("room-plain", 0, 0),
      { ...room("room-older-pin", 0, 0), pinned_at: "2026-07-01T00:00:00Z" },
      { ...room("room-newer-pin", 0, 0), pinned_at: "2026-07-02T00:00:00Z" },
      otherAgent,
      agent,
    ]);

    const chats = screen
      .getByRole("heading", { name: "Messages" })
      .closest("section")!;
    const links = within(chats)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label"));
    expect(links.slice(0, 3)).toEqual([
      "room-newer-pin",
      "room-older-pin",
      "Codex",
    ]);
    expect(links).toEqual(expect.arrayContaining(["room-plain", "Claude"]));
    expect(
      within(screen.getByRole("link", { name: "room-newer-pin" })).getByRole(
        "img",
        { name: "Pinned" },
      ),
    ).toBeInTheDocument();
  });

  it("pins a Room from its row and offers Pin and Delete for an Agent chat", async () => {
    const agent = { ...deletedDirectRoom(), direct_peer_active: true };
    const updateRoomPin = renderPinnedNavigation([
      room("room-plain", 0, 0),
      agent,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Pin room-plain" }));
    await waitFor(() =>
      expect(updateRoomPin).toHaveBeenCalledWith("room-plain", true),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for Codex" }),
    );
    const menu = await screen.findByRole("menu", {
      name: "More actions for Codex",
    });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Pin", "Copy Room link", "Delete"]);
    // Only the Human who registered the Agent may remove it.
    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toBeDisabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pin" }));
    await waitFor(() =>
      expect(updateRoomPin).toHaveBeenCalledWith(agent.id, true),
    );
  });

  it("keeps the Delete dialog outside the row's pointer-transparent actions", async () => {
    const agent = { ...deletedDirectRoom(), direct_peer_active: true };
    const jenny = {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    };
    const server = new TeamHubTestServer()
      .on("GET", "/v0/me", () => ({ actors: [jenny] }))
      .on("GET", "/v0/tenants/{tenantId}/agents", () => ({
        items: [
          {
            actor: agent.direct_peer,
            agent_type: "general",
            created_by: jenny,
            status: "active",
          },
        ],
        page: { has_more: false },
      }));
    renderPinnedNavigation([agent], server);

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for Codex" }),
    );
    const remove = await screen.findByRole("menuitem", { name: "Delete" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);

    const dialog = await waitFor(() => {
      const element = document.querySelector("dialog");
      expect(element).not.toBeNull();
      return element!;
    });
    // The strip ignores the pointer whenever the row is not hovered, and a
    // dialog inheriting that renders but cannot be clicked.
    expect(dialog.closest(".row-reveal-action")).toBeNull();
  });
});

describe("Room navigation composer focus", () => {
  function StateProbe() {
    const location = useLocation();
    return (
      <output aria-label="Location state">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
    );
  }
  function navigation() {
    return (
      <MemoryRouter initialEntries={["/t/tenant-a/rooms/room-active/chat"]}>
        <RoomSecondaryNavigation
          activeRoomId="room-active"
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={[room("room-active", 0, 0), room("room-other", 0, 0)]}
          tenant={{
            created_at: "2026-07-24T09:00:00Z",
            id: "tenant-a",
            name: "Northstar",
          }}
        />
        <StateProbe />
      </MemoryRouter>
    );
  }

  it("asks the next Room to focus its composer after a mouse click", () => {
    render(navigation());
    fireEvent.click(screen.getByRole("link", { name: "room-other" }), {
      detail: 1,
    });
    expect(screen.getByLabelText("Location state")).toHaveTextContent(
      '/t/tenant-a/rooms/room-other/chat|{"focusComposer":true}',
    );
  });

  it("keeps keyboard activation and touch navigation without composer focus", () => {
    render(navigation());
    fireEvent.click(screen.getByRole("link", { name: "room-other" }), {
      detail: 0,
    });
    expect(screen.getByLabelText("Location state")).toHaveTextContent(
      "/t/tenant-a/rooms/room-other/chat|null",
    );
  });

  it("does not focus the composer from a coarse pointer", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(pointer: coarse)",
          media: query,
        }) as MediaQueryList,
    );
    render(navigation());
    fireEvent.click(screen.getByRole("link", { name: "room-other" }), {
      detail: 1,
    });
    expect(screen.getByLabelText("Location state")).toHaveTextContent(
      "/t/tenant-a/rooms/room-other/chat|null",
    );
    matchMedia.mockRestore();
  });
});

describe("Room navigation unread filter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderList({
    accountId,
    activeRoomId,
    rooms,
  }: {
    accountId?: string;
    activeRoomId?: string;
    rooms: TeamHubRoomListItem[];
  }) {
    return render(
      <MemoryRouter>
        <RoomSecondaryNavigation
          accountId={accountId}
          activeRoomId={activeRoomId}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={rooms}
          tenant={{
            created_at: "2026-07-24T09:00:00Z",
            id: "tenant-a",
            name: "Northstar",
          }}
        />
      </MemoryRouter>,
    );
  }

  /** The away recap names the same Rooms, so row queries stay inside the list. */
  function messagesSection() {
    return screen.getByRole("button", { name: "Messages" }).closest("section")!;
  }

  function filterButton(name: "All" | "Mentions" | "Unread") {
    return within(
      within(messagesSection()).getByRole("group", { name: "Room filter" }),
    ).getByRole("button", { name });
  }

  it("keeps unread Rooms and the active Room, and remembers the choice", () => {
    renderList({
      accountId: "account-a",
      activeRoomId: "room-active",
      rooms: [
        room("room-active", 0, 0),
        room("room-unread", 2, 0),
        room("room-mentioned", 0, 1),
        room("room-read", 0, 0),
      ],
    });
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    expect(filterButton("Unread")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(messagesSection()).getByRole("button", { name: "Create chat" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).getByRole("link", { name: "room-read" }),
    ).toBeVisible();

    fireEvent.click(filterButton("Unread"));

    expect(filterButton("Unread")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["room-active", "room-unread", "room-mentioned"]) {
      expect(
        within(messagesSection()).getByRole("link", { name }),
      ).toBeVisible();
    }
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-read" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("room-unread-filter.v1:account-a")).toBe(
      '"unread"',
    );

    fireEvent.click(filterButton("Unread"));

    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(messagesSection()).getByRole("link", { name: "room-read" }),
    ).toBeVisible();
    expect(localStorage.getItem("room-unread-filter.v1:account-a")).toBe(
      '"all"',
    );
  });

  it("keeps only Rooms with unread mentions in Mentions mode", () => {
    renderList({
      accountId: "account-a",
      activeRoomId: "room-active",
      rooms: [
        room("room-active", 0, 0),
        room("room-mentioned", 2, 1),
        room("room-unread", 3, 0),
        room("room-read", 0, 0),
      ],
    });
    fireEvent.click(filterButton("Mentions"));

    expect(filterButton("Mentions")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(messagesSection()).getByRole("link", { name: "room-active" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).getByRole("link", { name: "room-mentioned" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-unread" }),
    ).not.toBeInTheDocument();
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-read" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("room-unread-filter.v1:account-a")).toBe(
      '"mentions"',
    );
    // Filtering the rows leaves the unread counts and the recap alone.
    expect(
      within(
        within(messagesSection()).getByRole("link", { name: "room-mentioned" }),
      ).getByTitle("1 unread mention"),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "While you were away" }),
    ).toBeVisible();
  });

  it("restores the old boolean choice and the mentions choice", () => {
    localStorage.setItem("room-unread-filter.v1:account-a", "true");
    const legacy = renderList({
      accountId: "account-a",
      activeRoomId: "room-active",
      rooms: [room("room-active", 0, 0), room("room-read", 0, 0)],
    });

    expect(filterButton("Unread")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-read" }),
    ).not.toBeInTheDocument();
    legacy.unmount();

    localStorage.setItem(
      "room-unread-filter.v1:account-a",
      JSON.stringify("mentions"),
    );
    renderList({
      accountId: "account-a",
      rooms: [room("room-mentioned", 0, 1), room("room-unread", 2, 0)],
    });

    expect(filterButton("Mentions")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(messagesSection()).getByRole("link", { name: "room-mentioned" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-unread" }),
    ).not.toBeInTheDocument();
  });

  it("explains an empty unread filter and shows every Room again", () => {
    renderList({ rooms: [room("room-read", 0, 0)] });
    fireEvent.click(filterButton("Unread"));

    expect(
      within(messagesSection()).getByText("No unread Rooms"),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-read" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(messagesSection()).getByRole("button", { name: "Show all Rooms" }),
    );

    expect(
      within(messagesSection()).getByRole("link", { name: "room-read" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByText("No unread Rooms"),
    ).not.toBeInTheDocument();
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
  });

  it("explains an empty mentions filter and shows every Room again", () => {
    renderList({ rooms: [room("room-unread", 3, 0)] });
    fireEvent.click(filterButton("Mentions"));

    expect(
      within(messagesSection()).getByText("No unread mentions"),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByRole("link", { name: "room-unread" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(messagesSection()).getByRole("button", { name: "Show all Rooms" }),
    );

    expect(
      within(messagesSection()).getByRole("link", { name: "room-unread" }),
    ).toBeVisible();
    expect(
      within(messagesSection()).queryByText("No unread mentions"),
    ).not.toBeInTheDocument();
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows every Room when the stored choice cannot be parsed", () => {
    localStorage.setItem("room-unread-filter.v1:account-a", "{not json");
    renderList({
      accountId: "account-a",
      rooms: [room("room-read", 0, 0)],
    });

    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(messagesSection()).getByRole("link", { name: "room-read" }),
    ).toBeVisible();
  });
});

describe("Room navigation mention snooze", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderList(rooms: TeamHubRoomListItem[]) {
    return render(
      <MemoryRouter>
        <RoomSecondaryNavigation
          accountId="account-a"
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={rooms}
          tenant={{
            created_at: "2026-07-24T09:00:00Z",
            id: "tenant-a",
            name: "Northstar",
          }}
        />
      </MemoryRouter>,
    );
  }

  it("snoozes a Room's mentions from its row menu and turns them back on", async () => {
    renderList([room("room-a", 2, 1)]);
    expect(screen.queryByText("Snoozed")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const menu = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Snooze mentions for 1 hour",
      "Snooze mentions until tomorrow morning",
      "Snooze Room for 1 hour",
      "Snooze Room until tomorrow morning",
      "Mute mentions",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze mentions for 1 hour",
      }),
    );

    expect(await screen.findByText("Snoozed")).toBeVisible();
    const stored = JSON.parse(
      localStorage.getItem("room-mention-snooze.v1:account-a")!,
    );
    expect(Date.parse(stored["room-a"])).toBeGreaterThan(Date.now());
    // Snoozing quiets notifications only; the row keeps its unread numbers.
    expect(
      within(screen.getByRole("link", { name: "room-a" })).getByTitle(
        "1 unread mention",
      ),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const reopened = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    fireEvent.click(
      within(reopened).getByRole("menuitem", { name: "Turn off snoozing" }),
    );

    await waitFor(() => expect(screen.queryByText("Snoozed")).toBeNull());
    expect(
      JSON.parse(localStorage.getItem("room-mention-snooze.v1:account-a")!),
    ).toEqual({});
  });

  it("replaces a snooze with a mute so only one hint shows", async () => {
    renderList([room("room-a", 2, 1)]);

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const menu = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze mentions for 1 hour",
      }),
    );
    expect(await screen.findByText("Snoozed")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const reopened = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    fireEvent.click(
      within(reopened).getByRole("menuitem", { name: "Mute mentions" }),
    );

    expect(await screen.findByText("Muted")).toBeVisible();
    expect(screen.queryByText("Snoozed")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("room-mention-snooze.v1:account-a")!),
    ).toEqual({});
    expect(
      JSON.parse(localStorage.getItem("room-mention-mute.v1:account-a")!),
    ).toEqual(["room-a"]);
  });

  it("mutes a Room's mentions from its row menu until it is unmuted", async () => {
    renderList([room("room-a", 2, 1)]);
    expect(screen.queryByText("Muted")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const menu = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Mute mentions" }),
    );

    expect(await screen.findByText("Muted")).toBeVisible();
    // Muting quiets notifications only; the row keeps its unread numbers.
    expect(
      within(screen.getByRole("link", { name: "room-a" })).getByTitle(
        "1 unread mention",
      ),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for room-a" }),
    );
    const mutedMenu = await screen.findByRole("menu", {
      name: "More actions for room-a",
    });
    // A muted Room hides the mention snooze choices instead of offering both.
    expect(
      within(mutedMenu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Unmute mentions",
      "Snooze Room for 1 hour",
      "Snooze Room until tomorrow morning",
    ]);
    fireEvent.click(
      within(mutedMenu).getByRole("menuitem", { name: "Unmute mentions" }),
    );

    await waitFor(() => expect(screen.queryByText("Muted")).toBeNull());
    expect(
      JSON.parse(localStorage.getItem("room-mention-mute.v1:account-a")!),
    ).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem("room-mention-snooze.v1:account-a")!),
    ).toEqual({});
  });
});
describe("Room navigation snooze", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderList(rooms: TeamHubRoomListItem[], activeRoomId?: string) {
    return render(
      <MemoryRouter>
        <RoomSecondaryNavigation
          accountId="account-a"
          activeRoomId={activeRoomId}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={rooms}
          tenant={{
            created_at: "2026-07-24T09:00:00Z",
            id: "tenant-a",
            name: "Northstar",
          }}
        />
      </MemoryRouter>,
    );
  }

  async function openMenu(name: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `More actions for ${name}` }),
    );
    return screen.findByRole("menu", { name: `More actions for ${name}` });
  }

  it("snoozes a Room for an hour from its row menu", async () => {
    renderList([room("room-a", 0, 0), room("room-b", 2, 1)]);
    const menu = await openMenu("room-b");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze Room for 1 hour",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "room-b" })).toBeNull(),
    );
    const stored = JSON.parse(
      localStorage.getItem("room-snooze.v1:account-a")!,
    ) as Record<string, string>;
    const remaining = Date.parse(stored["room-b"]!) - Date.now();
    expect(remaining).toBeGreaterThan(ROOM_SNOOZE_HOUR_MS - 5_000);
    expect(remaining).toBeLessThanOrEqual(ROOM_SNOOZE_HOUR_MS);
    expect(
      screen.getByRole("button", { name: "1 snoozed Room" }),
    ).toBeVisible();
  });

  it("snoozes a Room until tomorrow morning", async () => {
    renderList([room("room-a", 0, 0)]);
    const menu = await openMenu("room-a");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze Room until tomorrow morning",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "room-a" })).toBeNull(),
    );
    const morning = new Date();
    morning.setHours(8, 0, 0, 0);
    if (morning <= new Date()) morning.setDate(morning.getDate() + 1);
    expect(
      JSON.parse(localStorage.getItem("room-snooze.v1:account-a")!)["room-a"],
    ).toBe(morning.toISOString());
  });

  it("keeps the active Room visible and brings it back from its menu", async () => {
    renderList([room("room-a", 0, 0), room("room-b", 0, 0)], "room-b");
    let menu = await openMenu("room-b");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze Room for 1 hour",
      }),
    );

    expect(screen.getByRole("link", { name: "room-b" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /snoozed Room/ })).toBeNull();

    menu = await openMenu("room-b");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Bring Room back" }),
    );

    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("room-snooze.v1:account-a")!),
      ).toEqual({}),
    );
    menu = await openMenu("room-b");
    expect(
      within(menu).getByRole("menuitem", { name: "Snooze Room for 1 hour" }),
    ).toBeVisible();
    expect(
      within(menu).queryByRole("menuitem", { name: "Bring Room back" }),
    ).toBeNull();
  });

  it("lists snoozed Rooms in one collapsed line and brings one back", async () => {
    renderList([
      room("room-a", 0, 0),
      room("room-b", 3, 1),
      room("room-c", 0, 0),
    ]);
    for (const name of ["room-b", "room-c"]) {
      const menu = await openMenu(name);
      fireEvent.click(
        within(menu).getByRole("menuitem", {
          name: "Snooze Room for 1 hour",
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("link", { name })).toBeNull(),
      );
    }

    const line = screen.getByRole("button", { name: "2 snoozed Rooms" });
    expect(line).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Bring back room-b" }),
    ).toBeNull();

    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Bring back room-b" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Bring back room-b" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "1 snoozed Room" }),
      ).toBeVisible(),
    );
    const restored = screen.getByRole("link", { name: "room-b" });
    expect(restored).toBeVisible();
    // Snoozing only hid the row; its unread numbers come back unchanged.
    expect(within(restored).getByTitle("1 unread mention")).toBeVisible();
  });

  it("keeps Room snoozing separate from mention snoozing", async () => {
    renderList([room("room-a", 2, 1)]);
    let menu = await openMenu("room-a");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze mentions for 1 hour",
      }),
    );

    expect(await screen.findByText("Snoozed")).toBeVisible();
    expect(screen.getByRole("link", { name: "room-a" })).toBeVisible();
    expect(localStorage.getItem("room-snooze.v1:account-a")).toBeNull();

    menu = await openMenu("room-a");
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Snooze Room for 1 hour",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "room-a" })).toBeNull(),
    );
    const mentionStored = JSON.parse(
      localStorage.getItem("room-mention-snooze.v1:account-a")!,
    ) as Record<string, string>;
    expect(Date.parse(mentionStored["room-a"]!)).toBeGreaterThan(Date.now());
    expect(
      screen.getByRole("button", { name: "1 snoozed Room" }),
    ).toBeVisible();
  });
});

describe("Room navigation draft hint", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const scope = { accountId: "account-a", tenantId: "tenant-a" };

  function draft(body: string): RoomComposerDraft {
    return {
      body,
      documentContexts: [],
      documentReferences: [],
      mentions: [],
      skillReferences: [],
    };
  }

  function navigation(
    rooms: TeamHubRoomListItem[],
    accountId = scope.accountId,
  ) {
    return (
      <MemoryRouter>
        <RoomSecondaryNavigation
          accountId={accountId}
          onCloseMobile={() => undefined}
          onCreateRoom={() => undefined}
          rooms={rooms}
          tenant={{
            created_at: "2026-07-24T09:00:00Z",
            id: "tenant-a",
            name: "Northstar",
          }}
        />
      </MemoryRouter>
    );
  }

  it("marks only the Rooms that hold a draft", () => {
    writeRoomComposerDraft(
      { ...scope, roomId: "room-drafted" },
      draft("Unsent"),
    );
    writeRoomComposerDraft(
      { ...scope, roomId: "room-thread", threadId: "message-1" },
      draft("A reply"),
    );
    writeRoomComposerDraft({ ...scope, roomId: "room-direct" }, draft("Hello"));

    render(
      navigation([
        room("room-drafted", 0, 0),
        room("room-thread", 0, 0),
        room("room-clear", 0, 0),
        deletedDirectRoom(),
      ]),
    );

    expect(
      screen.getByRole("img", { name: "Draft in room-drafted" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Draft in room-thread" }),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "Draft in Codex" })).toBeVisible();
    expect(
      screen.queryByRole("img", { name: "Draft in room-clear" }),
    ).toBeNull();
  });

  it("follows the composer as it saves and clears a draft", () => {
    render(navigation([room("room-drafted", 0, 0)]));
    const hint = () =>
      screen.queryByRole("img", { name: "Draft in room-drafted" });

    expect(hint()).toBeNull();

    act(() => {
      writeRoomComposerDraft(
        { ...scope, roomId: "room-drafted" },
        draft("Unsent"),
      );
    });
    expect(hint()).toBeVisible();

    act(() => {
      writeRoomComposerDraft({ ...scope, roomId: "room-drafted" }, draft(""));
    });
    expect(hint()).toBeNull();
  });

  it("keeps one draft subscription until the Account changes", async () => {
    const roomDrafts = await import("./room-drafts");
    const unsubscribe = vi.fn();
    const subscribe = vi
      .spyOn(roomDrafts, "subscribeRoomComposerDrafts")
      .mockReturnValue(unsubscribe);
    const rooms = [room("room-drafted", 0, 0)];

    const { rerender } = render(navigation(rooms));
    expect(subscribe).toHaveBeenCalledTimes(1);

    rerender(navigation([room("room-drafted", 2, 1)]));
    expect(subscribe).toHaveBeenCalledTimes(1);

    rerender(navigation(rooms, "account-b"));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
