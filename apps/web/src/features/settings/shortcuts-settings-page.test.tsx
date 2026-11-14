import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { keyboardShortcutGroups } from "./keyboard-shortcuts";
import { ShortcutsSettingsPage } from "./shortcuts-settings-page";

describe("Shortcuts settings page", () => {
  it("lists every group and its shortcuts", () => {
    render(<ShortcutsSettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Shortcuts" }),
    ).toBeVisible();
    for (const group of keyboardShortcutGroups) {
      expect(
        screen.getByRole("heading", { level: 2, name: group.title }),
      ).toBeVisible();
      expect(screen.getByText(group.description)).toBeVisible();
      for (const shortcut of group.shortcuts) {
        const row = screen.getByText(shortcut.action).closest("div");
        expect(row).not.toBeNull();
        expect(
          Array.from(row!.querySelectorAll("kbd"), (cap) => cap.textContent),
        ).toEqual(
          shortcut.keys.other === undefined
            ? [shortcut.keys.mac]
            : [shortcut.keys.mac, shortcut.keys.other],
        );
      }
    }
  });
});
