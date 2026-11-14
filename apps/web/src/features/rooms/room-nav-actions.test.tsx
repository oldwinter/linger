import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "@/lib/clipboard";
import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRoomListItem,
  TeamHubRoomPage,
} from "@/features/teamhub/teamhub-types";
import {
  teamHubErrorResponse,
  TeamHubTestServer,
  type TestRouteRequest,
} from "@/test/teamhub-test-server";

import {
  AgentRowMenu,
  RoomHeaderMenu,
  RoomMentionMenu,
} from "./room-nav-actions";
import { tenantRoomsQueryKey } from "./room-queries";

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));

const copy = vi.mocked(writeClipboardText);
const tenantId = "tenant-a";
const roomsKey = tenantRoomsQueryKey(tenantId);
const readStatePath = "/v0/rooms/{roomId}/read-state";

describe("Copy Room link", () => {
  beforeEach(() => {
    copy.mockReset();
    copy.mockResolvedValue(undefined);
  });

  it("copies a Room's chat URL from its row menu", async () => {
    renderAgentRowMenu();

    await openCopyRoomLink("Codex");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-direct/chat");
  });

  it("copies the same Room URL from the Room header menu", async () => {
    render(
      <RoomHeaderMenu name="Launch" roomId="room-direct" tenantId="tenant-a" />,
    );

    await openCopyRoomLink("Launch");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-direct/chat");
  });

  it("copies a thread Room's own URL", async () => {
    render(
      <RoomHeaderMenu
        name="Launch Thread"
        roomId="room-thread-7"
        tenantId="tenant-a"
      />,
    );

    await openCopyRoomLink("Launch Thread");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-thread-7/chat");
  });

  it("reports a refused clipboard write instead of Copied", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    render(
      <RoomHeaderMenu name="Launch" roomId="room-direct" tenantId="tenant-a" />,
    );

    await openCopyRoomLink("Launch");

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("reports a refused clipboard write from the row menu too", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    renderAgentRowMenu();

    await openCopyRoomLink("Codex");

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });
});

describe("Mark as read", () => {
  it("acknowledges a Room's unread Messages from its row menu", async () => {
    const server = new TeamHubTestServer().allowUnhandledRoutes();
    const readState = vi.fn(({ body, params }: TestRouteRequest) => {
      const update = body as ReadStateRequest["body"];
      return {
        read_through_room_seq: update.through_room_seq,
        room_id: params.roomId,
        updated_at: "2026-11-15T09:00:00Z",
      };
    });
    server.on("PUT", readStatePath, readState);
    const queryClient = seededRooms();

    renderAgentRowMenu({ markReadThrough: 12, queryClient, server });

    await openMenuItem("Codex", "Mark as read");

    await waitFor(() =>
      expect(readState).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { through_room_seq: 12 },
          params: { roomId: "room-direct" },
        }),
      ),
    );
    await waitFor(() => {
      const page = queryClient.getQueryData<TeamHubRoomPage>(roomsKey)!;
      expect(page.items[0]).toMatchObject({
        id: "room-direct",
        read_through_room_seq: 12,
        unread_mention_count: 0,
        unread_message_count: 0,
      });
      expect(page.items[1]).toMatchObject({
        id: "room-other",
        read_through_room_seq: 5,
        unread_mention_count: 0,
        unread_message_count: 2,
      });
    });
  });

  it("acknowledges a Room from its mention menu as well", async () => {
    const server = new TeamHubTestServer().allowUnhandledRoutes();
    const readState = vi.fn(({ body, params }: TestRouteRequest) => {
      const update = body as ReadStateRequest["body"];
      return {
        read_through_room_seq: update.through_room_seq,
        room_id: params.roomId,
        updated_at: "2026-11-15T09:00:00Z",
      };
    });
    server.on("PUT", readStatePath, readState);
    const queryClient = seededRooms();

    renderRoomMentionMenu({ markReadThrough: 8, queryClient, server });

    await openMenuItem("room-a", "Mark as read");

    await waitFor(() =>
      expect(readState).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { through_room_seq: 8 },
          params: { roomId: "room-other" },
        }),
      ),
    );
  });

  it("shows a plain error and leaves the Room list alone when the update fails", async () => {
    const server = new TeamHubTestServer().allowUnhandledRoutes();
    server.on("PUT", readStatePath, () =>
      teamHubErrorResponse(503, "ROOM_READ_STATE_UNAVAILABLE"),
    );
    const queryClient = seededRooms();

    renderAgentRowMenu({ markReadThrough: 12, queryClient, server });

    await openMenuItem("Codex", "Mark as read");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not mark as read.",
    );
    const page = queryClient.getQueryData<TeamHubRoomPage>(roomsKey)!;
    expect(page.items[0]).toMatchObject({
      id: "room-direct",
      read_through_room_seq: 3,
      unread_mention_count: 1,
      unread_message_count: 4,
    });
  });

  it("offers nothing without a cursor to acknowledge", async () => {
    renderAgentRowMenu();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for Codex" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Copy Room link" }),
    ).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Mark as read" })).toBeNull();
  });

  it("keeps the action disabled while the update is in flight", async () => {
    const server = new TeamHubTestServer().allowUnhandledRoutes();
    let acknowledge!: () => void;
    server.on(
      "PUT",
      readStatePath,
      () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({
              read_through_room_seq: 12,
              room_id: "room-direct",
              updated_at: "2026-11-15T09:00:00Z",
            });
        }),
    );
    const queryClient = seededRooms();

    renderAgentRowMenu({ markReadThrough: 12, queryClient, server });
    await openMenuItem("Codex", "Mark as read");

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for Codex" }),
    );
    const menu = await screen.findByRole("menu", {
      name: "More actions for Codex",
    });
    expect(
      within(menu).getByRole("menuitem", { name: "Mark as read" }),
    ).toBeDisabled();

    acknowledge();
    await waitFor(() =>
      expect(
        queryClient.getQueryData<TeamHubRoomPage>(roomsKey)?.items[0],
      ).toMatchObject({ read_through_room_seq: 12 }),
    );
  });
});

interface ReadStateRequest {
  body: { through_room_seq: number };
  params: { roomId: string };
}

function seededRooms() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData<TeamHubRoomPage>(roomsKey, {
    items: [directRoom(), otherRoom()],
    page: { has_more: false },
  });
  return queryClient;
}

function directRoom(): TeamHubRoomListItem {
  return {
    ...otherRoom(),
    direct_peer: {
      display_name: "Codex",
      id: "actor-codex",
      kind: "agent",
      tenant_id: tenantId,
    },
    direct_peer_active: true,
    id: "room-direct",
    kind: "direct",
    latest_message: latestMessage(12),
    latest_room_seq: 12,
    name: "Codex",
    read_through_room_seq: 3,
    unread_mention_count: 1,
    unread_message_count: 4,
  };
}

function otherRoom(): TeamHubRoomListItem {
  return {
    created_at: "2026-11-15T08:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: tenantId,
    },
    id: "room-other",
    kind: "room",
    latest_room_seq: 9,
    name: "Other",
    read_through_room_seq: 5,
    tenant_id: tenantId,
    unread_mention_count: 0,
    unread_message_count: 2,
    updated_at: "2026-11-15T09:00:00Z",
  };
}

function latestMessage(roomSeq: number) {
  return {
    author: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human" as const,
      tenant_id: tenantId,
    },
    created_at: "2026-11-15T09:00:00Z",
    id: "message-latest",
    raw_message: "Newest message",
    room_seq: roomSeq,
  };
}

function renderAgentRowMenu({
  markReadThrough,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  roomId = "room-direct",
  server = new TeamHubTestServer().allowUnhandledRoutes(),
}: {
  markReadThrough?: number;
  queryClient?: QueryClient;
  roomId?: string;
  server?: TeamHubTestServer;
} = {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtimeFor(server)}>
        <AgentRowMenu
          agentId={undefined}
          markReadThrough={markReadThrough}
          name="Codex"
          onTogglePin={() => undefined}
          pinned={false}
          roomId={roomId}
          tenantId={tenantId}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function renderRoomMentionMenu({
  markReadThrough,
  queryClient,
  server,
}: {
  markReadThrough?: number;
  queryClient: QueryClient;
  server: TeamHubTestServer;
}) {
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtimeFor(server)}>
        <RoomMentionMenu
          accountId="account-a"
          markReadThrough={markReadThrough}
          muted={false}
          name="room-a"
          roomId="room-other"
          snoozed={false}
          tenantId={tenantId}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function runtimeFor(server: TeamHubTestServer) {
  return {
    client: createHttpTeamHubClient({
      fetchRequest: server.fetch,
      onAuthenticationRequired: () => undefined,
    }),
    events: {},
    runStatuses: {},
  } as unknown as TeamHubRuntime;
}

async function openCopyRoomLink(name: string) {
  await openMenuItem(name, "Copy Room link");
}

async function openMenuItem(name: string, item: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `More actions for ${name}` }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}
