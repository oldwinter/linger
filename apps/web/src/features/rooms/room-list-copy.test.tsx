import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "@/lib/clipboard";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { RoomSecondaryNavigation } from "./room-secondary-navigation";
import { ROOM_SNOOZE_HOUR_MS, setRoomSnooze } from "./room-snooze";

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));

const copy = vi.mocked(writeClipboardText);
const origin = window.location.origin;

describe("Room list copy", () => {
  beforeEach(() => {
    localStorage.clear();
    copy.mockReset();
    copy.mockResolvedValue(undefined);
  });

  it("copies the Rooms shown, pinned first and snoozed left out", async () => {
    setRoomSnooze(
      "account-a",
      "room-snoozed",
      new Date(Date.now() + ROOM_SNOOZE_HOUR_MS),
      new Date(),
    );
    renderNavigation([
      room({
        created_at: "2026-07-24T09:00:00Z",
        id: "room-launch",
        name: "Launch",
        pinned_at: "2026-07-01T00:00:00Z",
      }),
      room({
        created_at: "2026-07-24T09:00:01Z",
        id: "room-snoozed",
        name: "Snoozed",
      }),
      room({
        created_at: "2026-07-24T09:00:02Z",
        id: "room-quiet",
        name: "Quiet",
      }),
      room({
        created_at: "2026-07-24T09:00:03Z",
        id: "room-design",
        name: "Design",
        unread_message_count: 2,
      }),
      room({
        created_at: "2026-07-24T09:00:04Z",
        direct_peer: {
          display_name: "Codex",
          id: "actor-codex",
          kind: "agent",
          tenant_id: "tenant-a",
        },
        id: "room-codex",
        kind: "direct",
        name: "Codex chat",
        unread_mention_count: 1,
      }),
    ]);

    await copyRoomList();

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith(
      [
        "# Messages",
        `- [Launch](${origin}/t/tenant-a/rooms/room-launch/chat)`,
        `- [Codex](${origin}/t/tenant-a/rooms/room-codex/chat) (1 unread mention)`,
        `- [Design](${origin}/t/tenant-a/rooms/room-design/chat) (2 unread messages)`,
        `- [Quiet](${origin}/t/tenant-a/rooms/room-quiet/chat)`,
      ].join("\n"),
    );
  });

  it("copies only the Rooms an active filter shows", async () => {
    renderNavigation([
      room({
        created_at: "2026-07-24T09:00:01Z",
        id: "room-quiet",
        name: "Quiet",
      }),
      room({
        created_at: "2026-07-24T09:00:02Z",
        id: "room-unread",
        name: "Unread",
        unread_message_count: 4,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Quiet" })).toBeNull(),
    );

    await copyRoomList();

    expect(copy).toHaveBeenCalledWith(
      [
        "# Messages",
        `- [Unread](${origin}/t/tenant-a/rooms/room-unread/chat) (4 unread messages)`,
      ].join("\n"),
    );
  });

  it("disables the action when the list shows no Rooms", async () => {
    renderNavigation([]);

    fireEvent.click(screen.getByRole("button", { name: "Room list actions" }));
    const menu = await screen.findByRole("menu", {
      name: "Room list actions",
    });

    expect(
      within(menu).getByRole("menuitem", {
        name: "Copy Room list as Markdown",
      }),
    ).toBeDisabled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("reports a refused clipboard write", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    renderNavigation([room({ id: "room-a", name: "room-a" })]);

    await copyRoomList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });
});

async function copyRoomList() {
  fireEvent.click(screen.getByRole("button", { name: "Room list actions" }));
  const menu = await screen.findByRole("menu", { name: "Room list actions" });
  fireEvent.click(
    within(menu).getByRole("menuitem", {
      name: "Copy Room list as Markdown",
    }),
  );
  await waitFor(() => expect(copy).toHaveBeenCalled());
}

function renderNavigation(rooms: TeamHubRoomListItem[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={liveRuntime()}>
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
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function liveRuntime(): TeamHubRuntime {
  return {
    client: {} as TeamHubRuntime["client"],
    events: {} as TeamHubRuntime["events"],
    runStatuses: {} as TeamHubRuntime["runStatuses"],
  };
}

function room(
  override: Partial<TeamHubRoomListItem> & { id: string; name: string },
): TeamHubRoomListItem {
  return {
    created_at: "2026-07-24T09:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    kind: "room",
    latest_room_seq: 4,
    read_through_room_seq: 4,
    tenant_id: "tenant-a",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-24T10:00:00Z",
    ...override,
  };
}
