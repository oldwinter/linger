// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearDesktopNotificationPause,
  clearDesktopNotificationPauses,
  desktopNotificationPauseUntil,
  hasDesktopNotificationPauses,
  isDesktopNotificationPaused,
  readDesktopNotificationPause,
  setDesktopNotificationPause,
  subscribeDesktopNotificationPause,
} from "./desktop-notification-pause";
import {
  MENTION_SNOOZE_HOUR_MS,
  nextLocalMorning,
} from "./room-mention-snooze";

const ACCOUNT = "account-a";
const STORAGE_KEY = "desktop-notification-pause.v1:account-a";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("desktop notification pause model", () => {
  it("pauses for an hour", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    const until = desktopNotificationPauseUntil("hour", now);
    expect(until.getTime() - now.getTime()).toBe(MENTION_SNOOZE_HOUR_MS);
  });

  it("pauses until the morning the mention snooze would choose", () => {
    const lateNight = new Date(2026, 10, 15, 23, 30);
    expect(desktopNotificationPauseUntil("morning", lateNight).getTime()).toBe(
      nextLocalMorning(lateNight).getTime(),
    );
  });

  it("reads a pause back and ends exactly at its instant", () => {
    const until = new Date("2026-11-15T11:00:00.000Z");
    setDesktopNotificationPause(ACCOUNT, until);

    expect(readDesktopNotificationPause(ACCOUNT)).toBe(until.toISOString());
    expect(
      isDesktopNotificationPaused(
        readDesktopNotificationPause(ACCOUNT),
        new Date(until.getTime() - 1),
      ),
    ).toBe(true);
    expect(
      isDesktopNotificationPaused(readDesktopNotificationPause(ACCOUNT), until),
    ).toBe(false);
  });

  it("leaves an expired pause in storage without treating it as paused", () => {
    const until = new Date("2026-11-15T09:00:00.000Z");
    setDesktopNotificationPause(ACCOUNT, until);

    expect(
      isDesktopNotificationPaused(
        readDesktopNotificationPause(ACCOUNT),
        new Date("2026-11-15T10:00:00.000Z"),
      ),
    ).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("keeps each Account's pause separate", () => {
    setDesktopNotificationPause(ACCOUNT, new Date("2026-11-15T11:00:00.000Z"));

    expect(readDesktopNotificationPause("account-b")).toBeUndefined();
    expect(readDesktopNotificationPause(undefined)).toBeUndefined();
  });

  it("clears the pause on resume", () => {
    setDesktopNotificationPause(ACCOUNT, new Date("2026-11-15T11:00:00.000Z"));

    clearDesktopNotificationPause(ACCOUNT);

    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();
    expect(isDesktopNotificationPaused(undefined, new Date())).toBe(false);
  });

  it("treats corrupt or blocked storage as no pause", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();

    localStorage.setItem(STORAGE_KEY, JSON.stringify("not an instant"));
    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      setDesktopNotificationPause(ACCOUNT, new Date()),
    ).not.toThrow();
  });

  it("reports and clears the pause of every Account", () => {
    expect(hasDesktopNotificationPauses()).toBe(false);

    setDesktopNotificationPause(ACCOUNT, new Date("2026-11-15T11:00:00.000Z"));
    setDesktopNotificationPause(
      "account-b",
      new Date("2026-11-15T11:00:00.000Z"),
    );
    localStorage.setItem("unrelated", "keep");

    expect(hasDesktopNotificationPauses()).toBe(true);

    clearDesktopNotificationPauses();

    expect(hasDesktopNotificationPauses()).toBe(false);
    expect(readDesktopNotificationPause(ACCOUNT)).toBeUndefined();
    expect(readDesktopNotificationPause("account-b")).toBeUndefined();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("signals this tab and other tabs when the pause changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopNotificationPause(listener);

    setDesktopNotificationPause(ACCOUNT, new Date("2026-11-15T11:00:00.000Z"));
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent("storage"));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    clearDesktopNotificationPause(ACCOUNT);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
