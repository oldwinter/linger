// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MENTION_SNOOZE_HOUR_MS,
  clearRoomMentionSnooze,
  isRoomMentionSnoozed,
  nextLocalMorning,
  pruneRoomMentionSnooze,
  readRoomMentionSnooze,
  roomMentionSnoozeUntil,
  setRoomMentionSnooze,
  snoozedRoomIds,
  withRoomMentionSnooze,
  withoutRoomMentionSnooze,
  writeRoomMentionSnooze,
} from "./room-mention-snooze";

const ACCOUNT = "account-a";
const STORAGE_KEY = "room-mention-snooze.v1:account-a";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("room mention snooze model", () => {
  it("snoozes a Room for an hour and ends exactly at the expiry", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    const until = roomMentionSnoozeUntil("hour", now);
    expect(until.getTime() - now.getTime()).toBe(MENTION_SNOOZE_HOUR_MS);

    const snooze = withRoomMentionSnooze({}, "room-a", until);
    expect(isRoomMentionSnoozed(snooze, "room-a", now)).toBe(true);
    expect(
      isRoomMentionSnoozed(snooze, "room-a", new Date(until.getTime() - 1)),
    ).toBe(true);
    expect(isRoomMentionSnoozed(snooze, "room-a", until)).toBe(false);
    expect(isRoomMentionSnoozed(snooze, "room-b", now)).toBe(false);
  });

  it("snoozes until the next local morning across a date boundary", () => {
    const lateNight = new Date(2026, 10, 15, 23, 30);
    const morning = nextLocalMorning(lateNight);
    expect([
      morning.getFullYear(),
      morning.getMonth(),
      morning.getDate(),
      morning.getHours(),
      morning.getMinutes(),
      morning.getSeconds(),
    ]).toEqual([2026, 10, 16, 8, 0, 0]);

    const beforeMorning = nextLocalMorning(new Date(2026, 10, 15, 7, 0));
    expect([beforeMorning.getDate(), beforeMorning.getHours()]).toEqual([
      15, 8,
    ]);
    // At the morning hour itself the next morning is tomorrow's.
    expect(nextLocalMorning(new Date(2026, 10, 15, 8, 0)).getDate()).toBe(16);
  });

  it("prunes expired and unreadable entries and keeps the live ones", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    expect(
      pruneRoomMentionSnooze(
        {
          expired: "2026-11-15T09:59:59.999Z",
          live: "2026-11-15T10:00:00.001Z",
          unreadable: "not a date",
        },
        now,
      ),
    ).toEqual({ live: "2026-11-15T10:00:00.001Z" });
    expect([
      ...snoozedRoomIds(
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
    expect(withoutRoomMentionSnooze(snooze, "a")).toEqual({
      b: "2026-11-15T12:00:00.000Z",
    });
  });
});

describe("room mention snooze storage", () => {
  it("stores an Account's snoozes and reads back only the live ones", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    setRoomMentionSnooze(
      ACCOUNT,
      "room-a",
      new Date("2026-11-15T11:00:00.000Z"),
      now,
    );
    setRoomMentionSnooze(
      ACCOUNT,
      "room-b",
      new Date("2026-11-15T10:30:00.000Z"),
      now,
    );
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({
      "room-a": "2026-11-15T11:00:00.000Z",
      "room-b": "2026-11-15T10:30:00.000Z",
    });
    expect(
      readRoomMentionSnooze(ACCOUNT, new Date("2026-11-15T10:45:00.000Z")),
    ).toEqual({ "room-a": "2026-11-15T11:00:00.000Z" });

    clearRoomMentionSnooze(ACCOUNT, "room-a", now);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      "room-b": "2026-11-15T10:30:00.000Z",
    });
  });

  it("treats corrupt or unreadable storage as nothing snoozed", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["room-a"]));
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "room-a": 42 }));
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({});

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRoomMentionSnooze(ACCOUNT, now)).toEqual({});
  });

  it("keeps the Room list working when the browser refuses to store", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeRoomMentionSnooze(ACCOUNT, {})).not.toThrow();
    expect(readRoomMentionSnooze(undefined, new Date())).toEqual({});
  });
});
