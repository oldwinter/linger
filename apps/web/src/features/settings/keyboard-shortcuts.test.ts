import { describe, expect, it } from "vitest";

import { keyboardShortcutGroups } from "./keyboard-shortcuts";

describe("keyboardShortcutGroups", () => {
  it("names every group and shortcut", () => {
    expect(keyboardShortcutGroups.length).toBeGreaterThan(0);
    const titles = keyboardShortcutGroups.map((group) => group.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const group of keyboardShortcutGroups) {
      expect(group.title.trim()).not.toBe("");
      expect(group.description.trim()).not.toBe("");
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.action.trim()).not.toBe("");
        expect(shortcut.keys.mac.trim()).not.toBe("");
        if (shortcut.keys.other !== undefined) {
          expect(shortcut.keys.other.trim()).not.toBe("");
          // A platform spelling that matches macOS would be shown twice.
          expect(shortcut.keys.other).not.toBe(shortcut.keys.mac);
        }
      }
    }
  });

  it("does not repeat a key combination inside one group", () => {
    for (const group of keyboardShortcutGroups) {
      const combinations = group.shortcuts.map(
        (shortcut) =>
          `${shortcut.keys.mac}\u0000${shortcut.keys.other ?? shortcut.keys.mac}`,
      );
      expect(new Set(combinations).size).toBe(combinations.length);
    }
  });
});
