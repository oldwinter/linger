import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { roomMarkReadCursor } from "./room-mark-read";

describe("roomMarkReadCursor", () => {
  it("acknowledges the newest Message when it is past the read cursor", () => {
    expect(
      roomMarkReadCursor(
        room({ latest_message: latestMessage(12), read_through_room_seq: 9 }),
      ),
    ).toBe(12);
  });

  it("offers nothing when the Room has no unread Messages", () => {
    expect(
      roomMarkReadCursor(
        room({
          latest_message: latestMessage(12),
          read_through_room_seq: 9,
          unread_message_count: 0,
        }),
      ),
    ).toBeUndefined();
  });

  it("offers nothing without a latest Message", () => {
    expect(
      roomMarkReadCursor(
        room({ latest_message: undefined, read_through_room_seq: 9 }),
      ),
    ).toBeUndefined();
  });

  it("offers nothing when the latest Message is already read", () => {
    expect(
      roomMarkReadCursor(
        room({ latest_message: latestMessage(9), read_through_room_seq: 9 }),
      ),
    ).toBeUndefined();
  });

  it("offers nothing for a cursor that is not a whole sequence", () => {
    expect(
      roomMarkReadCursor(
        room({
          latest_message: latestMessage(Number.NaN),
          read_through_room_seq: 9,
        }),
      ),
    ).toBeUndefined();
  });
});

function room(
  overrides: Partial<TeamHubRoomListItem> = {},
): TeamHubRoomListItem {
  return {
    created_at: "2026-11-15T08:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    id: "room-a",
    kind: "room",
    latest_room_seq: 12,
    name: "Room A",
    read_through_room_seq: 0,
    tenant_id: "tenant-a",
    unread_mention_count: 0,
    unread_message_count: 3,
    updated_at: "2026-11-15T09:00:00Z",
    ...overrides,
  };
}

function latestMessage(roomSeq: number) {
  return {
    author: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human" as const,
      tenant_id: "tenant-a",
    },
    created_at: "2026-11-15T09:00:00Z",
    id: "message-latest",
    raw_message: "Newest message",
    room_seq: roomSeq,
  };
}
