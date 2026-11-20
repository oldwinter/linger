import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { AwayRecapCard } from "./away-recap-card";

const DAY = "2026-07-24T";
const DISMISSAL_KEY = "away-recap-dismissed.v1:account-a:tenant-a";

function room(
  id: string,
  unreadMessages: number,
  unreadMentions = 0,
  latest: { at: string; text: string } | null = null,
): TeamHubRoomListItem {
  return {
    created_at: `${DAY}09:00:00Z`,
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    id,
    kind: "room",
    latest_message: latest
      ? {
          author: {
            display_name: "Sam",
            id: "actor-sam",
            kind: "human",
            tenant_id: "tenant-a",
          },
          created_at: latest.at,
          id: `message-${id}`,
          raw_message: latest.text,
          room_seq: 4,
        }
      : undefined,
    latest_room_seq: 4,
    name: id,
    read_through_room_seq: unreadMessages > 0 ? 1 : 4,
    tenant_id: "tenant-a",
    unread_mention_count: unreadMentions,
    unread_message_count: unreadMessages,
    updated_at: `${DAY}10:00:00Z`,
  };
}

/** The route keeps `activeRoomId` in step with the link the test clicks. */
function AwayRecapRoute({
  accountId,
  rooms,
}: {
  accountId: string;
  rooms: TeamHubRoomListItem[];
}) {
  const location = useLocation();
  const activeRoomId = /^\/t\/tenant-a\/rooms\/([^/]+)\/chat$/.exec(
    location.pathname,
  )?.[1];
  return (
    <>
      <AwayRecapCard
        accountId={accountId}
        activeRoomId={activeRoomId}
        rooms={rooms}
        tenantId="tenant-a"
      />
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function renderCard(
  rooms: TeamHubRoomListItem[],
  { accountId = "account-a" }: { accountId?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/t/tenant-a/rooms"]}>
      <Routes>
        <Route
          element={<AwayRecapRoute accountId={accountId} rooms={rooms} />}
          path="*"
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("AwayRecapCard", () => {
  it("counts the unread Rooms and names three with their latest snippets", () => {
    renderCard([
      room("room-design", 2, 1, {
        at: `${DAY}11:00:00Z`,
        text: "**Ship** the draft",
      }),
      room("room-release", 3, 0, {
        at: `${DAY}10:00:00Z`,
        text: "Ready to go",
      }),
      room("room-ops", 1, 0, {
        at: `${DAY}09:30:00Z`,
        text: "Restarted the worker",
      }),
      room("room-old", 6, 0, { at: `${DAY}08:00:00Z`, text: "Old news" }),
    ]);

    expect(
      screen.getByRole("heading", { name: "While you were away" }),
    ).toBeVisible();
    expect(
      screen.getByText("12 new messages in 4 rooms, 1 mention"),
    ).toBeVisible();
    expect(screen.getByText("Ship the draft")).toBeVisible();
    expect(screen.getByText("Ready to go")).toBeVisible();
    expect(screen.getByText("Restarted the worker")).toBeVisible();
    expect(screen.queryByText("Old news")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Catch up, 4 chats" }),
    ).toHaveAttribute("href", "/t/tenant-a/rooms/catch-up");
  });

  it("opens a Room from its row and keeps the other Rooms", () => {
    renderCard([
      room("room-design", 2, 1, {
        at: `${DAY}11:00:00Z`,
        text: "Ship the draft",
      }),
      room("room-release", 3, 0, {
        at: `${DAY}10:00:00Z`,
        text: "Ready to go",
      }),
    ]);

    fireEvent.click(screen.getByRole("link", { name: /room-design/ }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-a/rooms/room-design/chat",
    );
    expect(screen.queryByText("room-design")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "While you were away" }),
    ).toBeVisible();
    expect(screen.getByText("room-release")).toBeVisible();
  });

  it("dismisses until a Room has newer activity, per Account", () => {
    const rooms = [
      room("room-design", 2, 1, {
        at: `${DAY}11:00:00Z`,
        text: "Ship the draft",
      }),
    ];
    const first = renderCard(rooms);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss recap" }));

    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISSAL_KEY)).toBe(`${DAY}11:00:00Z`);
    first.unmount();

    const again = renderCard(rooms);
    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).not.toBeInTheDocument();
    again.unmount();

    const otherAccount = renderCard(rooms, { accountId: "account-b" });
    expect(
      screen.getByRole("heading", { name: "While you were away" }),
    ).toBeVisible();
    otherAccount.unmount();

    renderCard([
      ...rooms,
      room("room-release", 4, 0, {
        at: `${DAY}12:00:00Z`,
        text: "Ready to go",
      }),
    ]);
    expect(
      screen.getByRole("heading", { name: "While you were away" }),
    ).toBeVisible();
    expect(
      screen.getByText("6 new messages in 2 rooms, 1 mention"),
    ).toBeVisible();
  });

  it("shows nothing when no Room has unread Messages", () => {
    renderCard([
      room("room-read", 0, 0),
      { ...room("room-thread", 3, 0), kind: "thread" },
    ]);

    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).not.toBeInTheDocument();
  });
});
