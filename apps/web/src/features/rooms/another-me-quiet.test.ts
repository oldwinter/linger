import { afterEach, describe, expect, it } from "vitest";

import {
  hourQuietUntil,
  morningQuietUntil,
  quietLabel,
  readQuietUntil,
  writeQuietUntil,
} from "./another-me-quiet";

afterEach(() => {
  globalThis.localStorage?.clear();
  writeQuietUntil("account-jenny", undefined);
  writeQuietUntil("account-other", undefined);
});

describe("Another Me quiet hours", () => {
  it("holds until 8:00 this morning, or the next morning once 8:00 has passed", () => {
    expect(morningQuietUntil(new Date(2026, 10, 14, 7, 30))).toBe(
      new Date(2026, 10, 14, 8, 0).getTime(),
    );
    expect(morningQuietUntil(new Date(2026, 10, 14, 8, 0))).toBe(
      new Date(2026, 10, 15, 8, 0).getTime(),
    );
    expect(morningQuietUntil(new Date(2026, 10, 14, 23, 10))).toBe(
      new Date(2026, 10, 15, 8, 0).getTime(),
    );
  });

  it("holds for one hour from now", () => {
    const now = new Date(2026, 10, 14, 9, 5);
    expect(hourQuietUntil(now)).toBe(new Date(2026, 10, 14, 10, 5).getTime());
  });

  it("names the end on today, tomorrow, or a later date", () => {
    const morning = new Date(2026, 10, 14, 7, 0);
    expect(quietLabel(new Date(2026, 10, 14, 8, 0).getTime(), morning)).toBe(
      "Quiet until 8:00 AM",
    );
    expect(quietLabel(new Date(2026, 10, 15, 8, 0).getTime(), morning)).toBe(
      "Quiet until 8:00 AM tomorrow",
    );
    expect(quietLabel(new Date(2026, 10, 16, 8, 0).getTime(), morning)).toBe(
      "Quiet until 8:00 AM on Nov 16",
    );
  });

  it("keeps one Account's hold on this computer and ignores a past or broken value", () => {
    const until = new Date(2026, 10, 15, 8, 0).getTime();
    writeQuietUntil("account-jenny", until);
    expect(readQuietUntil("account-jenny", until - 1)).toBe(until);
    expect(readQuietUntil("account-other", until - 1)).toBeUndefined();
    expect(readQuietUntil("account-jenny", until)).toBeUndefined();
    globalThis.localStorage?.setItem(
      "linger.another-me-quiet.account-jenny",
      "later",
    );
    if (globalThis.localStorage) {
      expect(readQuietUntil("account-jenny")).toBeUndefined();
    }
    writeQuietUntil("account-jenny", until);
    writeQuietUntil("account-jenny", undefined);
    expect(readQuietUntil("account-jenny", until - 1)).toBeUndefined();
  });
});
