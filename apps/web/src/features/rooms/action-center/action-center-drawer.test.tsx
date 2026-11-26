import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { ActionCenterDrawer } from "./action-center-drawer";

function makeRoom(
  id: string,
  overrides: Partial<TeamHubRoomListItem> = {},
): TeamHubRoomListItem {
  return {
    created_at: "2026-11-26T09:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    id,
    kind: "room",
    latest_room_seq: 4,
    name: id,
    read_through_room_seq: 4,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-11-26T10:00:00Z",
    ...overrides,
  };
}

describe("ActionCenterDrawer", () => {
  it("renders calm empty state when there are no active runs or alerts", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ActionCenterDrawer
          failedRoomIds={[]}
          onClose={onClose}
          rooms={[makeRoom("room-quiet")]}
          runningRoomIds={[]}
          tenantId="tenant-northstar"
        />
      </MemoryRouter>,
    );

    const dialog = screen.getByRole("dialog", { name: "Action center" });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByText("All quiet — no active runs or alerts"),
    ).toBeVisible();

    const closeButton = within(dialog).getByRole("button", {
      name: "Close action center",
    });
    expect(closeButton).toHaveAttribute("data-voice-close");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows active runs and needs-attention rooms with one-click navigation links", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const runningRoom = makeRoom("room-working", {
      direct_peer: {
        display_name: "Codex",
        id: "actor-codex",
        kind: "agent",
        tenant_id: "tenant-northstar",
      },
      kind: "direct",
      latest_message: {
        author: {
          display_name: "Jenny",
          id: "actor-jenny",
          kind: "human",
          tenant_id: "tenant-northstar",
        },
        created_at: "2026-11-26T10:05:00Z",
        id: "msg-1",
        raw_message: "Ship the release checklist",
        room_seq: 5,
      },
      name: "Codex",
    });
    const failedRoom = makeRoom("room-broken", {
      latest_message: {
        author: {
          display_name: "Reviewer",
          id: "actor-reviewer",
          kind: "agent",
          tenant_id: "tenant-northstar",
        },
        created_at: "2026-11-26T10:03:00Z",
        id: "msg-2",
        raw_message: "Could not reach endpoint",
        room_seq: 2,
      },
      name: "Release Ops",
      unread_mention_count: 2,
    });
    const mentionedRoom = makeRoom("room-mentions", {
      name: "Design Crit",
      unread_mention_count: 1,
    });

    render(
      <MemoryRouter>
        <ActionCenterDrawer
          failedRoomIds={["room-broken"]}
          onClose={onClose}
          onNavigate={onNavigate}
          rooms={[runningRoom, failedRoom, mentionedRoom]}
          runningRoomIds={["room-working"]}
          tenantId="tenant-northstar"
        />
      </MemoryRouter>,
    );

    const activeSection = screen.getByRole("region", { name: "Active runs" });
    expect(within(activeSection).getByText("Codex")).toBeVisible();
    expect(within(activeSection).getByText("Working")).toBeVisible();
    expect(
      within(activeSection).getByText("Ship the release checklist"),
    ).toBeVisible();
    const openCodex = within(activeSection).getByRole("link", {
      name: "Open Codex",
    });
    expect(openCodex).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-working/chat",
    );

    const attentionSection = screen.getByRole("region", {
      name: "Needs attention",
    });
    expect(within(attentionSection).getByText("Release Ops")).toBeVisible();
    expect(within(attentionSection).getByText("Run failed")).toBeVisible();
    expect(within(attentionSection).getByText("2 mentions")).toBeVisible();
    expect(within(attentionSection).getByText("Design Crit")).toBeVisible();
    expect(within(attentionSection).getByText("1 mention")).toBeVisible();

    fireEvent.click(openCodex);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
