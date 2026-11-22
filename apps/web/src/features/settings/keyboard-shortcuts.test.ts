import { describe, expect, it } from "vitest";

import {
  filterKeyboardShortcutGroups,
  keyboardShortcutGroups,
} from "./keyboard-shortcuts";

describe("keyboardShortcutGroups", () => {
  it("names every group and shortcut uniquely", () => {
    expect(keyboardShortcutGroups.length).toBeGreaterThanOrEqual(7);
    const titles = keyboardShortcutGroups.map((group) => group.title);
    expect(new Set(titles).size).toBe(titles.length);
    const actions: string[] = [];
    for (const group of keyboardShortcutGroups) {
      expect(group.title.trim()).not.toBe("");
      expect(group.description.trim()).not.toBe("");
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.action.trim()).not.toBe("");
        actions.push(shortcut.action);
        expect(shortcut.keys.mac.trim()).not.toBe("");
        if (shortcut.keys.other !== undefined) {
          expect(shortcut.keys.other.trim()).not.toBe("");
          // A platform spelling that matches macOS would be shown twice.
          expect(shortcut.keys.other).not.toBe(shortcut.keys.mac);
        }
      }
    }
    expect(new Set(actions).size).toBe(actions.length);
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

  it("filters groups by title, action, or key label", () => {
    expect(filterKeyboardShortcutGroups("   ")).toBe(keyboardShortcutGroups);

    const byKey = filterKeyboardShortcutGroups("ctrl k");
    expect(byKey.map((group) => group.title)).toEqual(["Global"]);
    expect(byKey[0]?.shortcuts.map((shortcut) => shortcut.action)).toEqual([
      "Open search",
    ]);

    const byTitle = filterKeyboardShortcutGroups("wiki directory");
    expect(byTitle.map((group) => group.title)).toEqual(["Wiki directory"]);
    expect(byTitle[0]?.shortcuts.length).toBeGreaterThan(1);

    expect(filterKeyboardShortcutGroups("does-not-exist")).toEqual([]);

    const jump = filterKeyboardShortcutGroups("ctrl j");
    expect(jump[0]?.shortcuts.map((shortcut) => shortcut.action)).toEqual([
      "Jump to a room, meeting, or library place",
    ]);

    const roomFind = filterKeyboardShortcutGroups("ctrl f");
    expect(roomFind[0]?.shortcuts.map((shortcut) => shortcut.action)).toEqual([
      "Search in current room",
    ]);
  });
});
