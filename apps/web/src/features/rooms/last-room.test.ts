// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLastRooms,
  pickLandingRoom,
  readLastRoom,
  rememberLastRoom,
} from "./last-room";

beforeEach(() => window.localStorage.clear());

describe("pickLandingRoom", () => {
  const rooms = ["room-another-me", "room-design"];

  it("opens the room the person left when it still exists", () => {
    expect(pickLandingRoom(rooms, "room-another-me", "room-design")).toBe(
      "room-design",
    );
  });

  it("opens Another Me on the first visit", () => {
    expect(pickLandingRoom(rooms, "room-another-me", undefined)).toBe(
      "room-another-me",
    );
  });

  it("drops a remembered room that is gone", () => {
    expect(pickLandingRoom(rooms, "room-another-me", "room-gone")).toBe(
      "room-another-me",
    );
  });
});

describe("last room storage", () => {
  it("remembers one room per space and clears with the browser preferences", () => {
    rememberLastRoom("account-a", "tenant-northstar", "room-design");
    expect(readLastRoom("account-a", "tenant-northstar")).toBe("room-design");
    expect(readLastRoom("account-b", "tenant-northstar")).toBeUndefined();
    clearLastRooms();
    expect(readLastRoom("account-a", "tenant-northstar")).toBeUndefined();
  });
});
