// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readRoomMentionSnooze,
  setRoomMentionSnooze,
} from "./room-mention-snooze";
import {
  ROOM_SNOOZE_HOUR_MS,
  clearRoomSnooze,
  clearRoomSnoozes,
  hasRoomSnoozes,
  isRoomSnoozed,
  pruneRoomSnooze,
  readRoomSnooze,
  roomSnoozedIds,
  roomSnoozeUntil,
  setRoomSnooze,
  subscribeRoomSnooze,
  withRoomSnooze,
  withoutRoomSnooze,
  writeRoomSnooze,
} from "./room-snooze";

const ACCOUNT = "account-a";
const STORAGE_KEY = "room-snooze.v1:account-a";
const MENTION_STORAGE_KEY = "room-mention-snooze.v1:account-a";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("room snooze model", () => {
  it("hides a Room for an hour and ends exactly at the expiry", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    const until = roomSnoozeUntil("hour", now);
    expect(until.getTime() - now.getTime()).toBe(ROOM_SNOOZE_HOUR_MS);

    const snooze = withRoomSnooze({}, "room-a", until);
    expect(isRoomSnoozed(snooze, "room-a", now)).toBe(true);
    expect(isRoomSnoozed(snooze, "room-a", new Date(until.getTime() - 1))).toBe(
      true,
    );
    expect(isRoomSnoozed(snooze, "room-a", until)).toBe(false);
    expect(isRoomSnoozed(snooze, "room-b", now)).toBe(false);
  });

  it("hides a Room until the next local morning", () => {
    const morning = roomSnoozeUntil("morning", new Date(2026, 10, 15, 23, 30));
    expect([
      morning.getFullYear(),
      morning.getMonth(),
      morning.getDate(),
      morning.getHours(),
      morning.getMinutes(),
    ]).toEqual([2026, 10, 16, 8, 0]);
  });

  it("prunes expired and unreadable entries and keeps the live ones", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    expect(
      pruneRoomSnooze(
        {
          expired: "2026-11-15T09:59:59.999Z",
          live: "2026-11-15T10:00:00.001Z",
          unreadable: "not a date",
        },
        now,
      ),
    ).toEqual({ live: "2026-11-15T10:00:00.001Z" });
    expect([
      ...roomSnoozedIds(
        {
          a: "2026-11-15T11:00:00.000Z",
          b: "2026-11-15T09:00:00.000Z",
        },
        now,
      ),
    ]).toEqual(["a"]);
  });

  it("clears one Room and leaves the others", () => {
    const snooze = {
      a: "2026-11-15T11:00:00.000Z",
      b: "2026-11-15T12:00:00.000Z",
    };
    expect(withoutRoomSnooze(snooze, "a")).toEqual({
      b: "2026-11-15T12:00:00.000Z",
    });
  });
});

describe("room snooze storage", () => {
  it("stores an Account's snoozes and reads back only the live ones", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    setRoomSnooze(ACCOUNT, "room-a", new Date("2026-11-15T11:00:00.000Z"), now);
    setRoomSnooze(ACCOUNT, "room-b", new Date("2026-11-15T10:30:00.000Z"), now);
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({
      "room-a": "2026-11-15T11:00:00.000Z",
      "room-b": "2026-11-15T10:30:00.000Z",
    });

    const later = new Date("2026-11-15T10:45:00.000Z");
    expect(readRoomSnooze(ACCOUNT, later)).toEqual({
      "room-a": "2026-11-15T11:00:00.000Z",
    });
    // An expired snooze is absent without needing a cleanup write.
    expect(
      readRoomSnooze(ACCOUNT, new Date("2026-11-15T12:00:00.000Z")),
    ).toEqual({});
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      "room-a": "2026-11-15T11:00:00.000Z",
      "room-b": "2026-11-15T10:30:00.000Z",
    });

    clearRoomSnooze(ACCOUNT, "room-a", now);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      "room-b": "2026-11-15T10:30:00.000Z",
    });

    clearRoomSnooze(ACCOUNT, "room-b", now);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasRoomSnoozes()).toBe(false);
  });

  it("keeps each Account's snoozes apart", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    setRoomSnooze(ACCOUNT, "room-a", new Date("2026-11-15T11:00:00.000Z"), now);

    expect(readRoomSnooze("account-b", now)).toEqual({});
    expect(readRoomSnooze(undefined, now)).toEqual({});
  });

  it("treats corrupt or unreadable storage as nothing snoozed", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["room-a"]));
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "room-a": 42 }));
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({});

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({});
  });

  it("keeps the Room list working when the browser refuses to store", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeRoomSnooze(ACCOUNT, {})).not.toThrow();
  });

  it("reports and clears the snoozes of every Account", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    expect(hasRoomSnoozes()).toBe(false);

    setRoomSnooze(ACCOUNT, "room-a", new Date("2026-11-15T11:00:00.000Z"), now);
    setRoomSnooze(
      "account-b",
      "room-b",
      new Date("2026-11-15T11:00:00.000Z"),
      now,
    );
    localStorage.setItem("unrelated", "keep");

    expect(hasRoomSnoozes()).toBe(true);
    const listener = vi.fn();
    const stop = subscribeRoomSnooze(listener);

    clearRoomSnoozes();
    stop();

    expect(hasRoomSnoozes()).toBe(false);
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({});
    expect(readRoomSnooze("account-b", now)).toEqual({});
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(listener).toHaveBeenCalled();
  });

  it("leaves the mention snooze untouched", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    setRoomSnooze(ACCOUNT, "room-a", new Date("2026-11-15T11:00:00.000Z"), now);
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({});
    expect(localStorage.getItem(MENTION_STORAGE_KEY)).toBeNull();

    setRoomMentionSnooze(
      ACCOUNT,
      "room-a",
      new Date(now.getTime() + 3600000),
      now,
    );
    expect(readRoomSnooze(ACCOUNT, now)).toEqual({
      "room-a": "2026-11-15T11:00:00.000Z",
    });
  });
});
