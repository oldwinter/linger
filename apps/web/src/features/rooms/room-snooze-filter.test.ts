import { describe, expect, it } from "vitest";

import { splitSnoozedRooms } from "./room-snooze-filter";

const rows = [{ id: "room-a" }, { id: "room-b" }, { id: "room-c" }];

describe("splitSnoozedRooms", () => {
  it("drops snoozed Rooms from the list and keeps them for the snoozed line", () => {
    expect(
      splitSnoozedRooms(rows, new Set(["room-b", "room-c"]), "room-a"),
    ).toEqual({
      hidden: [{ id: "room-b" }, { id: "room-c" }],
      visible: [{ id: "room-a" }],
    });
  });

  it("keeps the active Room even when it is snoozed", () => {
    expect(
      splitSnoozedRooms(rows, new Set(["room-a", "room-b"]), "room-b"),
    ).toEqual({
      hidden: [{ id: "room-a" }],
      visible: [{ id: "room-b" }, { id: "room-c" }],
    });
  });

  it("shows everything when nothing is snoozed", () => {
    expect(splitSnoozedRooms(rows, new Set(), undefined)).toEqual({
      hidden: [],
      visible: rows,
    });
  });
});
