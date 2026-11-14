import { describe, expect, it } from "vitest";

import { todayNoteOutOfView } from "./pocket-note-today-jump";

const list = { top: 100, bottom: 500 };

describe("todayNoteOutOfView", () => {
  it("offers the jump for a page scrolled above the list", () => {
    expect(todayNoteOutOfView(list, { top: 0, bottom: 118 })).toBe(true);
  });

  it("offers the jump for a page below the list", () => {
    expect(todayNoteOutOfView(list, { top: 520, bottom: 638 })).toBe(true);
  });

  it("offers the jump when the page is only partly showing", () => {
    expect(todayNoteOutOfView(list, { top: 80, bottom: 198 })).toBe(true);
    expect(todayNoteOutOfView(list, { top: 420, bottom: 538 })).toBe(true);
  });

  it("keeps the jump away while the page is fully showing", () => {
    expect(todayNoteOutOfView(list, { top: 120, bottom: 238 })).toBe(false);
  });

  it("offers nothing for a page the list does not hold", () => {
    expect(todayNoteOutOfView(list, undefined)).toBe(false);
    expect(todayNoteOutOfView(list, null)).toBe(false);
    expect(todayNoteOutOfView(undefined, { top: 520, bottom: 638 })).toBe(
      false,
    );
  });
});
