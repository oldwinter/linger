import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  carryRoomTitle,
  decisionMessage,
  meetingDecisions,
  roomsThatCanReceive,
} from "./carry-decision";

const summary = `# Meeting

## Decisions And Outcomes

- Decision: Ship the web app first.
- Completed: The brief is written.
- Decision: Keep the launch room.
  - Tell the room why.

## Action Items

- Action: Confirm the release.
`;

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

describe("carry a decision", () => {
  it("keeps only decisions, in the order the meeting wrote them", () => {
    expect(meetingDecisions(summary).map((item) => item.text)).toEqual([
      "Ship the web app first.",
      "Keep the launch room.\nTell the room why.",
    ]);
    expect(decisionMessage("Meeting · Nov 12, 15:30", "Ship it.")).toBe(
      "From Meeting · Nov 12, 15:30:\n\nShip it.",
    );
  });

  it("offers rooms and leaves threads out", () => {
    const rooms = roomsThatCanReceive([
      room("thread", "A thread", "thread"),
      room("zeta", "zeta"),
      {
        ...room("codex", "Chat", "direct"),
        direct_peer: {
          display_name: "Codex",
          id: "actor-codex",
          kind: "agent",
          tenant_id: "tenant-northstar",
        },
      },
    ]);
    expect(rooms.map(carryRoomTitle)).toEqual(["Codex", "zeta"]);
  });
});
