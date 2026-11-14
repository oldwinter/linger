import { describe, expect, it } from "vitest";

import type { TeamHubRoomMember } from "@/features/teamhub/teamhub-types";

import { roomMembersMarkdown } from "./room-members-markdown";

describe("roomMembersMarkdown", () => {
  it("lists Humans and Agents in the order the members view shows", () => {
    expect(
      roomMembersMarkdown({
        members: [
          member("Jenny Bin", "human"),
          member("Maya Chen", "human"),
          member("Codex", "agent"),
          member("Lev8 GTM", "agent"),
        ],
        roomName: "Design",
      }),
    ).toBe(
      [
        "# Design",
        "",
        "- Jenny Bin (Human)",
        "- Maya Chen (Human)",
        "- Codex (Agent)",
        "- Lev8 GTM (Agent)",
      ].join("\n"),
    );
  });

  it("writes one entry for a Room with one member", () => {
    expect(
      roomMembersMarkdown({
        members: [member("Codex", "agent")],
        roomName: "Apprenticeship",
      }),
    ).toBe("# Apprenticeship\n\n- Codex (Agent)");
  });

  it("names only the Room when nobody is a member", () => {
    expect(roomMembersMarkdown({ members: [], roomName: "Design" })).toBe(
      "# Design",
    );
  });
});

function member(
  displayName: string,
  kind: TeamHubRoomMember["actor"]["kind"],
): Pick<TeamHubRoomMember, "actor"> {
  return {
    actor: {
      display_name: displayName,
      id: `actor-${displayName.toLowerCase().replaceAll(" ", "-")}`,
      kind,
      tenant_id: "tenant-northstar",
    },
  };
}
