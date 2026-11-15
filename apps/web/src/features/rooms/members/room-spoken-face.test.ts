import { describe, expect, it } from "vitest";

import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";

import { spokenRoomFace } from "./room-spoken-face";

function actor(id: string, name: string): TeamHubActorRef {
  return {
    display_name: name,
    id,
    kind: "human",
    tenant_id: "tenant-a",
  };
}

describe("spoken room face", () => {
  const jenny = actor("actor-jenny", "Jenny");
  const codex = actor("actor-codex", "Codex");

  it("puts the last speaker in front and keeps everyone else", () => {
    expect(
      spokenRoomFace([jenny, codex], codex).map((member) => member.id),
    ).toEqual(["actor-codex", "actor-jenny"]);
  });

  it("leaves a room that has not spoken, or already leads with them", () => {
    expect(spokenRoomFace([jenny, codex], undefined)).toEqual([jenny, codex]);
    expect(spokenRoomFace([jenny, codex], jenny)).toEqual([jenny, codex]);
    expect(spokenRoomFace([], codex)).toEqual([]);
  });
});
