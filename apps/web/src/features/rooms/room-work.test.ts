import { describe, expect, it } from "vitest";

import type { TeamHubRunStatus } from "@/features/teamhub/teamhub-types";

import { chooseRoomWorkRun } from "./room-work";

function run(
  id: string,
  status: TeamHubRunStatus["status"],
  replied: boolean,
  updatedAt: string,
): TeamHubRunStatus {
  return {
    agent: { display_name: "Codex", id: "agent-1", kind: "agent" },
    created_at: updatedAt,
    id,
    replied,
    revision: 1,
    room_id: "room-1",
    run_id: id,
    status,
    updated_at: updatedAt,
  };
}

describe("chooseRoomWorkRun", () => {
  it("prefers the run that is still working", () => {
    expect(
      chooseRoomWorkRun([
        run("finished", "completed", true, "2026-11-14T03:00:00Z"),
        run("live", "active", false, "2026-11-14T02:00:00Z"),
      ])?.id,
    ).toBe("live");
  });

  it("keeps the latest finished run when nothing is working", () => {
    expect(
      chooseRoomWorkRun([
        run("older", "completed", true, "2026-11-14T01:00:00Z"),
        run("newer", "completed", true, "2026-11-14T02:00:00Z"),
      ])?.id,
    ).toBe("newer");
    expect(chooseRoomWorkRun([])).toBeUndefined();
  });
});
