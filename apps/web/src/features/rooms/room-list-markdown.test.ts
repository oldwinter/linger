import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { roomListMarkdown } from "./room-list-markdown";

const origin = "https://app.example";

describe("Room list Markdown", () => {
  it("writes a heading and one linked entry per Room in the order given", () => {
    const markdown = roomListMarkdown({
      origin,
      rooms: [
        room({ id: "room-design", name: "Design" }),
        room({
          id: "room-launch",
          name: "Launch",
          pinned_at: "2026-07-02T00:00:00Z",
        }),
      ],
      tenantId: "tenant-a",
    });

    expect(markdown).toBe(
      [
        "# Messages",
        "- [Design](https://app.example/t/tenant-a/rooms/room-design/chat)",
        "- [Launch](https://app.example/t/tenant-a/rooms/room-launch/chat)",
      ].join("\n"),
    );
  });

  it("names unread Messages and gives unread mentions precedence", () => {
    const markdown = roomListMarkdown({
      origin,
      rooms: [
        room({ id: "room-quiet", name: "Quiet" }),
        room({
          id: "room-one-message",
          name: "One message",
          unread_message_count: 1,
        }),
        room({
          id: "room-messages",
          name: "Messages",
          unread_message_count: 3,
        }),
        room({
          id: "room-mentions",
          name: "Mentions",
          unread_mention_count: 2,
          unread_message_count: 5,
        }),
      ],
      tenantId: "tenant-a",
    });

    expect(markdown.split("\n").slice(1)).toEqual([
      "- [Quiet](https://app.example/t/tenant-a/rooms/room-quiet/chat)",
      "- [One message](https://app.example/t/tenant-a/rooms/room-one-message/chat) (1 unread message)",
      "- [Messages](https://app.example/t/tenant-a/rooms/room-messages/chat) (3 unread messages)",
      "- [Mentions](https://app.example/t/tenant-a/rooms/room-mentions/chat) (2 unread mentions)",
    ]);
  });

  it("shows a direct chat by the peer's name", () => {
    const markdown = roomListMarkdown({
      origin,
      rooms: [
        room({
          direct_peer: {
            display_name: "Codex",
            id: "actor-codex",
            kind: "agent",
            tenant_id: "tenant-a",
          },
          id: "room-direct",
          kind: "direct",
          name: "Agent chat",
        }),
      ],
      tenantId: "tenant-a",
    });

    expect(markdown).toBe(
      [
        "# Messages",
        "- [Codex](https://app.example/t/tenant-a/rooms/room-direct/chat)",
      ].join("\n"),
    );
  });

  it("escapes brackets so a name stays plain link text", () => {
    const markdown = roomListMarkdown({
      origin,
      rooms: [room({ id: "room-brackets", name: "Plan [draft]" })],
      tenantId: "tenant-a",
    });

    expect(markdown).toContain(
      "- [Plan \\[draft\\]](https://app.example/t/tenant-a/rooms/room-brackets/chat)",
    );
  });

  it("writes the heading alone when the list shows no Rooms", () => {
    expect(roomListMarkdown({ origin, rooms: [], tenantId: "tenant-a" })).toBe(
      "# Messages",
    );
  });
});

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
