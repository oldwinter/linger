import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  chooseSurprise,
  roomsToSpin,
  surpriseRoomTitle,
} from "./surprise-room";

function room(
  id: string,
  name: string,
  kind: TeamHubRoomListItem["kind"] = "room",
): TeamHubRoomListItem {
  return {
    created_at: "2026-11-01T00:00:00Z",
    created_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    id,
    kind,
    latest_room_seq: 1,
    name,
    read_through_room_seq: 1,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-11-01T00:00:00Z",
  };
}

describe("surprise me", () => {
  const rooms = [
    room("thread", "A thread", "thread"),
    room("zeta", "zeta"),
    {
      ...room("codex", "Chat", "direct"),
      direct_peer: {
        display_name: "Codex",
        id: "actor-codex",
        kind: "agent" as const,
        tenant_id: "tenant-northstar",
      },
    },
  ];

  it("lands on a room and leaves threads out", () => {
    expect(roomsToSpin(rooms).map(surpriseRoomTitle)).toEqual([
      "Codex",
      "zeta",
    ]);
    expect(chooseSurprise(rooms, () => 0)?.id).toBe("codex");
    expect(chooseSurprise(rooms, () => 0.99)?.id).toBe("zeta");
    expect(
      chooseSurprise([room("only", "Only thread", "thread")], () => 0),
    ).toBeUndefined();
  });
});
