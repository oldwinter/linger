import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { roomAgreedMessage } from "./room-agreed";

const people = ["alice", "bob"];

function message(
  id: string,
  text: string,
  reacted: readonly string[] = [],
  kind: TeamHubMessage["message_kind"] = "conversation",
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: id === "kept" ? "Alice" : "Bob",
      id: "author",
      kind: "human",
      tenant_id: "tenant",
    },
    created_at: "2026-11-15T00:00:00Z",
    id,
    message_kind: kind,
    raw_message: text,
    room_id: "room",
    segments: [{ content: text || "x", type: "text" }],
    tenant_id: "tenant",
    ...(reacted.length
      ? { reactions: [{ actor_ids: [...reacted], reaction_id: "heart" }] }
      : {}),
  };
}

describe("roomAgreedMessage", () => {
  it("keeps the newest message every person has reacted to", () => {
    const older = message("older", "Ship it", people);
    const newer = message("kept", "Wait for Maya", people);
    const open = message("open", "One more thing", ["alice"]);
    expect(roomAgreedMessage([older, newer, open], people)?.id).toBe("kept");
  });

  it("waits until every person has reacted, and ignores a room of one", () => {
    const line = message("line", "Ship it", ["alice"]);
    expect(roomAgreedMessage([line], people)).toBeUndefined();
    expect(
      roomAgreedMessage([message("line", "Ship it", ["alice"])], ["alice"]),
    ).toBeUndefined();
  });

  it("leaves a room notice and a card out of the agreement", () => {
    const notice = message("notice", "Maya joined", people, "room_notice");
    const card = message("card", "Approve", people);
    card.card = {} as TeamHubMessage["card"];
    expect(roomAgreedMessage([notice], people)).toBeUndefined();
    expect(roomAgreedMessage([card], people)).toBeUndefined();
  });
});
