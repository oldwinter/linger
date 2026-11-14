import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { awayRecap, awayRecapVisible } from "./away-recap";

const DAY = "2026-07-24T";

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

describe("awayRecap", () => {
  it("totals unread Messages and Mentions and names the three newest Rooms", () => {
    const recap = awayRecap(
      [
        room("active", 5, 2, { at: `${DAY}12:00:00Z`, text: "On screen" }),
        room("design", 2, 1, {
          at: `${DAY}11:00:00Z`,
          text: "**Ship** the draft",
        }),
        room("release", 3, 0, { at: `${DAY}10:00:00Z`, text: "Ready to go" }),
        room("ops", 1, 0, {
          at: `${DAY}09:30:00Z`,
          text: "Restarted the worker",
        }),
        room("old", 6, 0, { at: `${DAY}08:00:00Z`, text: "Old news" }),
        room("read", 0, 0, { at: `${DAY}13:00:00Z`, text: "All caught up" }),
      ],
      "active",
    );

    expect(recap.messageCount).toBe(12);
    expect(recap.mentionCount).toBe(1);
    expect(recap.roomCount).toBe(4);
    expect(recap.rows.map((row) => row.id)).toEqual([
      "design",
      "release",
      "ops",
    ]);
    expect(recap.rows[0]).toMatchObject({
      snippet: "Ship the draft",
      unreadCount: 2,
    });
    expect(recap.newestAt).toBe(`${DAY}11:00:00Z`);
  });

  it("leaves Threads and mention-only Rooms out of the totals", () => {
    const recap = awayRecap([
      room("parent", 2, 0, { at: `${DAY}11:00:00Z`, text: "parent" }),
      {
        ...room("thread", 4, 1, { at: `${DAY}12:00:00Z`, text: "thread" }),
        kind: "thread",
        parent_room_id: "parent",
      },
      room("mention-only", 0, 2, {
        at: `${DAY}13:00:00Z`,
        text: "mention",
      }),
    ]);

    expect(recap).toMatchObject({
      messageCount: 2,
      mentionCount: 0,
      roomCount: 1,
      newestAt: `${DAY}11:00:00Z`,
    });
    expect(recap.rows.map((row) => row.id)).toEqual(["parent"]);
  });

  it("names a direct Chat after its peer and falls back to the description", () => {
    const recap = awayRecap([
      {
        ...room("direct", 1, 0),
        description: "Ask Codex anything",
        direct_peer: {
          display_name: "Codex",
          id: "actor-codex",
          kind: "agent",
          tenant_id: "tenant-a",
        },
        kind: "direct",
        name: "Codex Chat",
      },
    ]);

    expect(recap.rows[0]).toMatchObject({
      name: "Codex",
      snippet: "Ask Codex anything",
    });
  });

  it("reports nothing when every unread Room is excluded", () => {
    expect(
      awayRecap(
        [
          room("read", 0, 0),
          { ...room("thread", 3, 0), kind: "thread" },
          room("open", 2, 0),
        ],
        "open",
      ),
    ).toEqual({
      messageCount: 0,
      mentionCount: 0,
      roomCount: 0,
      newestAt: null,
      rows: [],
    });
  });
});

describe("awayRecapVisible", () => {
  const recap = awayRecap([
    room("design", 2, 0, { at: `${DAY}11:00:00Z`, text: "Ship the draft" }),
  ]);

  it("shows until a dismissal covers the newest activity", () => {
    expect(awayRecapVisible(recap, null)).toBe(true);
    expect(awayRecapVisible(recap, `${DAY}10:59:59Z`)).toBe(true);
    expect(awayRecapVisible(recap, `${DAY}11:00:00Z`)).toBe(false);
    expect(awayRecapVisible(recap, `${DAY}12:00:00Z`)).toBe(false);
  });

  it("does not let damaged storage silence the recap", () => {
    expect(awayRecapVisible(recap, "not-a-timestamp")).toBe(true);
  });

  it("stays hidden with nothing unread", () => {
    expect(awayRecapVisible(awayRecap([]), null)).toBe(false);
  });
});
