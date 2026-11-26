import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { keyboardShortcutGroups } from "./keyboard-shortcuts";
import { ShortcutsSettingsPage } from "./shortcuts-settings-page";

describe("Shortcuts settings page", () => {
  it("lists every group and its shortcuts", () => {
    render(<ShortcutsSettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Shortcuts" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Desktop app only — browsers reserve this shortcut to reopen closed tabs.",
      ),
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

  it("filters shortcuts by query and clears via Escape or the clear button", () => {
    render(<ShortcutsSettingsPage />);

    const searchbox = screen.getByRole("searchbox", {
      name: "Filter shortcuts",
    });
    const searchIcon = searchbox.closest("label")?.querySelector("svg");
    expect(searchIcon).toHaveAttribute("width", "16");
    expect(searchIcon).toHaveAttribute("height", "16");
    fireEvent.change(searchbox, { target: { value: "recording" } });
    const clearIcon = screen
      .getByRole("button", { name: "Clear shortcuts filter" })
      .querySelector("svg");
    expect(clearIcon).toHaveAttribute("width", "14");
    expect(clearIcon).toHaveAttribute("height", "14");
    expect(
      screen.getByRole("heading", { level: 2, name: "Meeting audio player" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Global" }),
    ).toBeNull();

    fireEvent.keyDown(searchbox, { key: "Escape" });
    expect(searchbox).toHaveValue("");
    expect(
      screen.getByRole("heading", { level: 2, name: "Global" }),
    ).toBeVisible();

    fireEvent.change(searchbox, { target: { value: "no-such-shortcut" } });
    expect(screen.getByText("No shortcuts match that filter.")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear shortcuts filter" }),
    );
    expect(searchbox).toHaveValue("");
    expect(
      screen.getByRole("heading", { level: 2, name: "Work Items board" }),
    ).toBeVisible();
  });

  it("says what a pressed shortcut does, including every place Escape works", () => {
    render(<ShortcutsSettingsPage />);
    const stage = screen.getByRole("region", { name: "Shortcut you pressed" });
    expect(stage).toHaveTextContent("Press a shortcut.");

    fireEvent.keyDown(window, { key: "j" });
    expect(
      within(stage).getByText("Select the next Work Item card"),
    ).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(stage).getAllByText("Escape").length).toBeGreaterThan(0);
    expect(within(stage).getByText("Works anywhere in a Room.")).toBeVisible();
    expect(
      within(stage).getByText("Works while the search dialog has focus."),
    ).toBeVisible();
  });

  it("captures and stops rehearsed shortcuts before page handlers or scrolling run", () => {
    render(<ShortcutsSettingsPage />);
    const stage = screen.getByRole("region", { name: "Shortcut you pressed" });
    const bubbleListener = vi.fn();
    document.body.addEventListener("keydown", bubbleListener);
    try {
      const cmdK = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "k",
        metaKey: true,
      });
      fireEvent(document.body, cmdK);
      expect(cmdK.defaultPrevented).toBe(true);
      expect(bubbleListener).not.toHaveBeenCalled();
      expect(within(stage).getByText("Open search")).toBeVisible();

      const cmdJ = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "j",
        metaKey: true,
      });
      fireEvent(document.body, cmdJ);
      expect(cmdJ.defaultPrevented).toBe(true);
      expect(bubbleListener).not.toHaveBeenCalled();
      expect(
        within(stage).getByText("Jump to a room, meeting, or library place"),
      ).toBeVisible();

      const space = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: " ",
      });
      fireEvent(document.body, space);
      expect(space.defaultPrevented).toBe(true);
      expect(bubbleListener).not.toHaveBeenCalled();
      expect(
        within(stage).getByText("Play or pause the Meeting recording"),
      ).toBeVisible();
    } finally {
      document.body.removeEventListener("keydown", bubbleListener);
    }
  });
});
