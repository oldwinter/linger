import { describe, expect, it } from "vitest";

import {
  assigneesMissingFromRoom,
  assigneesMissingFromRoomText,
} from "./assignee-not-in-room";

describe("assignee not in the room", () => {
  const jenny = { id: "jenny", name: "Jenny" };
  const codex = { id: "codex", name: "Codex" };
  const alex = { id: "alex", name: "Alex" };

  it("names assignees who are not members", () => {
    expect(
      assigneesMissingFromRoom([jenny, codex, codex], new Set(["jenny"])).map(
        (actor) => actor.name,
      ),
    ).toEqual(["Codex"]);
    expect(assigneesMissingFromRoomText(["Codex"])).toBe(
      "Codex is assigned and is not in the room doing this work.",
    );
    expect(assigneesMissingFromRoomText(["Codex", "Alex"])).toBe(
      "Codex and Alex are assigned and are not in the room doing this work.",
    );
    expect(
      assigneesMissingFromRoom([jenny, codex, alex], new Set(["jenny"])).map(
        (actor) => actor.id,
      ),
    ).toEqual(["codex", "alex"]);
  });

  it("stays quiet when every assignee is in the room", () => {
    expect(assigneesMissingFromRoom([jenny], new Set(["jenny"]))).toEqual([]);
    expect(assigneesMissingFromRoomText([])).toBeUndefined();
  });
});
