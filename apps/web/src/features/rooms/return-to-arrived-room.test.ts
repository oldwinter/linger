import { describe, expect, it } from "vitest";

import {
  AWAY_BEFORE_RETURN_MS,
  roomToOpenOnReturn,
  type RoomReturnFact,
} from "./return-to-arrived-room";

function room(id: string, seq: number, kind = "collaboration"): RoomReturnFact {
  return { id, kind, seq };
}

const away = {
  dialogOpen: false,
  hiddenForMs: AWAY_BEFORE_RETURN_MS,
  writing: false,
};

describe("roomToOpenOnReturn", () => {
  it("opens the one room that moved while the window was hidden", () => {
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "here",
        after: [room("here", 4), room("design", 8)],
        before: [room("here", 4), room("design", 7)],
      }),
    ).toBe("design");
  });

  it("stays when several rooms moved, the open room moved, or the absence was brief", () => {
    const before = [room("here", 1), room("design", 1), room("ops", 1)];
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "here",
        after: [room("here", 1), room("design", 2), room("ops", 2)],
        before,
      }),
    ).toBeUndefined();
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "design",
        after: [room("here", 1), room("design", 2)],
        before: [room("here", 1), room("design", 1)],
      }),
    ).toBeUndefined();
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "here",
        after: [room("here", 1), room("design", 2)],
        before: [room("here", 1), room("design", 1)],
        hiddenForMs: AWAY_BEFORE_RETURN_MS - 1,
      }),
    ).toBeUndefined();
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "here",
        after: [room("here", 1), room("design", 2)],
        before: [room("here", 1), room("design", 1)],
        writing: true,
      }),
    ).toBeUndefined();
  });

  it("ignores a thread and a room that was not in the list before", () => {
    expect(
      roomToOpenOnReturn({
        ...away,
        activeRoomId: "here",
        after: [room("here", 1), room("thread-1", 9, "thread")],
        before: [room("here", 1), room("thread-1", 1, "thread")],
      }),
    ).toBeUndefined();
  });
});
