import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { resultTarget } from "./global-search-model";

describe("search room face", () => {
  it("leads a room result with whoever spoke last", () => {
    const room = {
      id: "room-1",
      kind: "room",
      member_preview: [
        {
          display_name: "Jenny",
          id: "jenny",
          kind: "human",
          tenant_id: "tenant-a",
        },
        {
          display_name: "Codex",
          id: "codex",
          kind: "agent",
          tenant_id: "tenant-a",
        },
      ],
      latest_message: {
        author: {
          display_name: "Codex",
          id: "codex",
          kind: "agent",
          tenant_id: "tenant-a",
        },
        created_at: "2026-07-24T10:00:00Z",
        id: "message-1",
        raw_message: "On it.",
        room_seq: 2,
      },
      name: "Launch",
    } as TeamHubRoomListItem;
    const target = resultTarget(
      { id: room.id, kind: "room", room },
      {
        directRoomIdByPeer: new Map(),
        roomNames: new Map(),
        tenantId: "tenant-a",
      },
    );
    expect(target.kind).toBe("room");
    if (target.kind !== "room") return;
    expect(target.members?.map((member) => member.id)).toEqual([
      "codex",
      "jenny",
    ]);
  });
});
