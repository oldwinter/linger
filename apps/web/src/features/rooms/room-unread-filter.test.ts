// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  readRoomUnreadFilter,
  unreadRoomRows,
  writeRoomUnreadFilter,
} from "./room-unread-filter";

const PREFERENCE_KEY = "room-unread-filter.v1:account-a";

function room(
  id: string,
  unreadMessages: number,
  unreadMentions = 0,
  kind: TeamHubRoomListItem["kind"] = "room",
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
    kind,
    latest_room_seq: 4,
    name: id,
    read_through_room_seq: unreadMessages ? 1 : 4,
    tenant_id: "tenant-a",
    unread_mention_count: unreadMentions,
    unread_message_count: unreadMessages,
    updated_at: "2026-07-24T10:00:00Z",
  };
}

describe("unreadRoomRows", () => {
  it("returns every Room when the filter is off", () => {
    const rooms = [room("design", 2), room("read", 0)];

    expect(unreadRoomRows(rooms, "read", false)).toEqual(rooms);
  });

  it("keeps Rooms with unread Messages or unread mentions", () => {
    const ids = unreadRoomRows(
      [room("design", 2), room("mentioned", 0, 1), room("read", 0)],
      undefined,
      true,
    ).map((row) => row.id);

    expect(ids).toEqual(["design", "mentioned"]);
  });

  it("keeps a read active Room visible", () => {
    const ids = unreadRoomRows(
      [room("design", 2), room("read", 0)],
      "read",
      true,
    ).map((row) => row.id);

    expect(ids).toEqual(["design", "read"]);
  });

  it("treats Threads and direct Chats like any other Room", () => {
    const ids = unreadRoomRows(
      [
        room("thread", 0, 0, "thread"),
        room("unread-thread", 3, 0, "thread"),
        room("direct", 0, 0, "direct"),
        room("unread-direct", 1, 0, "direct"),
      ],
      undefined,
      true,
    ).map((row) => row.id);

    expect(ids).toEqual(["unread-thread", "unread-direct"]);
  });

  it("returns no rows when nothing is unread and no Room is active", () => {
    expect(unreadRoomRows([room("read", 0)], undefined, true)).toEqual([]);
  });
});

describe("Room unread filter storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers the choice for the Account that made it", () => {
    writeRoomUnreadFilter("account-a", true);

    expect(localStorage.getItem(PREFERENCE_KEY)).toBe("true");
    expect(readRoomUnreadFilter("account-a")).toBe(true);

    writeRoomUnreadFilter("account-a", false);

    expect(readRoomUnreadFilter("account-a")).toBe(false);
  });

  it("starts off for another Account", () => {
    writeRoomUnreadFilter("account-a", true);

    expect(readRoomUnreadFilter("account-b")).toBe(false);
  });

  it("falls back to off when the stored value cannot be parsed", () => {
    localStorage.setItem(PREFERENCE_KEY, "{not json");

    expect(readRoomUnreadFilter("account-a")).toBe(false);
  });

  it("keeps no choice without an Account", () => {
    writeRoomUnreadFilter(undefined, true);

    expect(localStorage.length).toBe(0);
    expect(readRoomUnreadFilter(undefined)).toBe(false);
  });
});
