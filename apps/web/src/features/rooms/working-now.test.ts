import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { workingNowRooms, workingPhaseLabel } from "./working-now";

function room(
  id: string,
  overrides: Partial<TeamHubRoomListItem> = {},
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
    kind: "room",
    latest_room_seq: 1,
    name: id,
    read_through_room_seq: 1,
    tenant_id: "tenant-a",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-24T10:00:00Z",
    ...overrides,
  };
}

describe("working now", () => {
  it("keeps running rooms and follows the latest author's kind", () => {
    const rooms = workingNowRooms(
      [
        room("room-idle"),
        room("room-codex", {
          direct_peer: {
            display_name: "Codex",
            id: "actor-codex",
            kind: "agent",
            tenant_id: "tenant-a",
          },
          kind: "direct",
          latest_message: {
            author: {
              display_name: "Jenny",
              id: "actor-jenny",
              kind: "human",
              tenant_id: "tenant-a",
            },
            created_at: "2026-07-24T10:00:00Z",
            id: "message-1",
            raw_message: "**Ship** the brief",
            room_seq: 2,
          },
          name: "Codex",
        }),
        room("room-thread", { kind: "thread", name: "A thread" }),
        room("room-me", {
          latest_message: {
            author: {
              display_name: "Another Me",
              id: "actor-me",
              kind: "agent",
              tenant_id: "tenant-a",
            },
            created_at: "2026-07-24T10:05:00Z",
            id: "message-2",
            raw_message: "On it.",
            room_seq: 3,
          },
          name: "Another Me",
        }),
      ],
      ["room-codex", "room-thread", "room-me"],
    );
    expect(rooms).toEqual([
      {
        id: "room-codex",
        name: "Codex",
        phase: "on-your-message",
        preview: "Ship the brief",
      },
      {
        id: "room-me",
        name: "Another Me",
        phase: "replying",
        preview: "On it.",
      },
    ]);
    expect(workingPhaseLabel("on-your-message")).toBe("On your message");
    expect(workingPhaseLabel("replying")).toBe("Replying");
  });
});
