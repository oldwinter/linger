import { describe, expect, it } from "vitest";

import type { TeamHubScheduledRoutine } from "@/features/teamhub/teamhub-types";

import {
  joinedRoutineInstruction,
  routinesInTheSameMinute,
} from "./routine-same-minute";

function routine(
  id: string,
  instruction: string,
  next: string,
  createdAt: string,
): TeamHubScheduledRoutine {
  return {
    cadence: { kind: "once", run_at: next, timezone: "UTC" },
    created_at: createdAt,
    created_by_actor_id: "agent-1",
    enabled: true,
    id,
    instruction,
    name: id,
    next_run_at: next,
    revision: 1,
    room_id: "room-1",
    updated_at: createdAt,
  };
}

const atNine = "2026-10-02T09:00:30Z";
const alsoNine = "2026-10-02T09:00:50Z";

describe("routinesInTheSameMinute", () => {
  it("keeps the oldest routine in a shared minute and drops the rest", () => {
    const older = routine(
      "older",
      "Write the brief",
      atNine,
      "2026-09-01T00:00:00Z",
    );
    const newer = routine(
      "newer",
      "Send the notes",
      alsoNine,
      "2026-09-02T00:00:00Z",
    );
    const later = routine(
      "later",
      "Something else",
      "2026-10-02T11:00:00Z",
      "2026-09-01T00:00:00Z",
    );
    const group = routinesInTheSameMinute([newer, later, older]);
    expect(group?.keep.id).toBe("older");
    expect(group?.drop.map((item) => item.id)).toEqual(["newer"]);
    expect(joinedRoutineInstruction(older, [newer])).toBe(
      "Write the brief\n\nSend the notes",
    );
  });

  it("leaves a minute that belongs to one routine", () => {
    expect(
      routinesInTheSameMinute([
        routine("only", "Write the brief", atNine, "2026-09-01T00:00:00Z"),
      ]),
    ).toBeUndefined();
  });

  it("does not repeat an instruction the kept routine already has", () => {
    const older = routine(
      "older",
      "Write the brief",
      atNine,
      "2026-09-01T00:00:00Z",
    );
    const copy = routine(
      "copy",
      "Write the brief",
      alsoNine,
      "2026-09-02T00:00:00Z",
    );
    expect(joinedRoutineInstruction(older, [copy])).toBe("Write the brief");
  });
});
