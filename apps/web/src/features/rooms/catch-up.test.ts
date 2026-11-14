import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { beginCatchUp, catchUpAttention } from "./catch-up";

function room(
  id: string,
  unreadMessages: number,
  unreadMentions = 0,
  extras: Partial<TeamHubRoomListItem> = {},
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
    latest_room_seq: 4,
    name: id,
    read_through_room_seq: unreadMessages ? 1 : 4,
    tenant_id: "tenant-northstar",
    unread_mention_count: unreadMentions,
    unread_message_count: unreadMessages,
    updated_at: "2026-07-24T10:00:00Z",
    ...extras,
  };
}

describe("catch-up walk", () => {
  it("keeps chats with new messages or mentions and skips threads", () => {
    const walk = beginCatchUp([
      room("room-quiet", 0),
      room("room-notes", 2, 0, {
        latest_message: {
          author: {
            display_name: "Mina",
            id: "actor-mina",
            kind: "human",
            tenant_id: "tenant-northstar",
          },
          created_at: "2026-07-24T10:00:00Z",
          id: "message-1",
          raw_message: "**Ship** the brief",
          room_seq: 4,
        },
      }),
      room("room-thread", 3, 0, { kind: "thread", name: "A thread" }),
      room("room-mention", 0, 1, {
        direct_peer: {
          display_name: "Another Me",
          id: "actor-me",
          kind: "agent",
          tenant_id: "tenant-northstar",
        },
        kind: "direct",
        name: "Another Me Chat",
      }),
    ]);

    expect(walk).toEqual({
      index: 0,
      rooms: [
        {
          id: "room-notes",
          name: "room-notes",
          preview: "Ship the brief",
          unreadMentions: 0,
          unreadMessages: 2,
        },
        {
          id: "room-mention",
          name: "Another Me",
          preview: "",
          unreadMentions: 1,
          unreadMessages: 0,
        },
      ],
    });
    expect(catchUpAttention(walk.rooms[0]!)).toBe(
      "2 new messages when you started",
    );
    expect(catchUpAttention(walk.rooms[1]!)).toBe("1 mention when you started");
  });

  it("names messages and mentions together", () => {
    expect(
      catchUpAttention({
        id: "room-both",
        name: "Launch",
        preview: "",
        unreadMentions: 2,
        unreadMessages: 1,
      }),
    ).toBe("1 new message and 2 mentions when you started");
  });
});
