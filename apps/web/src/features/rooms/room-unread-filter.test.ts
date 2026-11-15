// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  clearRoomUnreadFilter,
  hasRoomUnreadFilter,
  mentionRoomRows,
  readRoomFilterMode,
  roomFilterRows,
  unreadRoomRows,
  writeRoomFilterMode,
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

const rooms = [
  room("design", 2),
  room("mentioned", 0, 1),
  room("both", 3, 2),
  room("read", 0),
];

describe("unreadRoomRows", () => {
  it("returns every Room when the filter is off", () => {
    expect(unreadRoomRows(rooms, "read", false)).toEqual(rooms);
  });

  it("keeps Rooms with unread Messages or unread mentions", () => {
    const ids = unreadRoomRows(rooms, undefined, true).map((row) => row.id);

    expect(ids).toEqual(["design", "mentioned", "both"]);
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

describe("mentionRoomRows", () => {
  it("keeps only Rooms with unread mentions", () => {
    const ids = mentionRoomRows(rooms, undefined).map((row) => row.id);

    expect(ids).toEqual(["mentioned", "both"]);
  });

  it("keeps the active Room even without a mention", () => {
    const ids = mentionRoomRows([...rooms, room("active", 0)], "active").map(
      (row) => row.id,
    );

    expect(ids).toEqual(["mentioned", "both", "active"]);
  });

  it("drops Rooms that only have plain unread Messages", () => {
    expect(mentionRoomRows([room("design", 4)], undefined)).toEqual([]);
  });
});

describe("roomFilterRows", () => {
  it("returns every Room for all", () => {
    expect(roomFilterRows(rooms, "read", "all")).toEqual(rooms);
  });

  it("uses the unread rule for unread", () => {
    expect(roomFilterRows(rooms, "read", "unread")).toEqual(
      unreadRoomRows(rooms, "read", true),
    );
  });

  it("uses the mention rule for mentions", () => {
    expect(roomFilterRows(rooms, "read", "mentions")).toEqual(
      mentionRoomRows(rooms, "read"),
    );
  });
});

describe("Room filter storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts on all", () => {
    expect(readRoomFilterMode("account-a")).toBe("all");
  });

  it("remembers each mode for the Account that chose it", () => {
    writeRoomFilterMode("account-a", "unread");
    expect(localStorage.getItem(PREFERENCE_KEY)).toBe('"unread"');
    expect(readRoomFilterMode("account-a")).toBe("unread");

    writeRoomFilterMode("account-a", "mentions");
    expect(readRoomFilterMode("account-a")).toBe("mentions");

    writeRoomFilterMode("account-a", "all");
    expect(readRoomFilterMode("account-a")).toBe("all");
    expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();
  });

  it("reads the old boolean choice as the mode it meant", () => {
    localStorage.setItem(PREFERENCE_KEY, "true");
    expect(readRoomFilterMode("account-a")).toBe("unread");

    localStorage.setItem(PREFERENCE_KEY, "false");
    expect(readRoomFilterMode("account-a")).toBe("all");
  });

  it("starts on all for another Account", () => {
    writeRoomFilterMode("account-a", "mentions");

    expect(readRoomFilterMode("account-b")).toBe("all");
  });

  it("falls back to all when the stored value cannot be parsed", () => {
    localStorage.setItem(PREFERENCE_KEY, "{not json");
    expect(readRoomFilterMode("account-a")).toBe("all");

    localStorage.setItem(PREFERENCE_KEY, JSON.stringify("archived"));
    expect(readRoomFilterMode("account-a")).toBe("all");

    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(42));
    expect(readRoomFilterMode("account-a")).toBe("all");
  });

  it("keeps no choice without an Account", () => {
    writeRoomFilterMode(undefined, "mentions");

    expect(localStorage.length).toBe(0);
    expect(readRoomFilterMode(undefined)).toBe("all");
  });

  it("reports and clears the choice of every Account", () => {
    expect(hasRoomUnreadFilter()).toBe(false);

    writeRoomFilterMode("account-a", "unread");
    writeRoomFilterMode("account-b", "mentions");
    localStorage.setItem("unrelated", "keep");

    expect(hasRoomUnreadFilter()).toBe(true);

    clearRoomUnreadFilter();

    expect(hasRoomUnreadFilter()).toBe(false);
    expect(readRoomFilterMode("account-a")).toBe("all");
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
