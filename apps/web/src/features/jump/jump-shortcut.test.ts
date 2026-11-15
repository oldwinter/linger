// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isJumpShortcut, jumpShortcutLabel } from "./jump-shortcut";

describe("jump shortcut", () => {
  it("accepts Cmd or Ctrl J and leaves Search's key alone", () => {
    expect(
      isJumpShortcut(new KeyboardEvent("keydown", { key: "j", metaKey: true })),
    ).toBe(true);
    expect(
      isJumpShortcut(new KeyboardEvent("keydown", { key: "j", ctrlKey: true })),
    ).toBe(true);
    expect(
      isJumpShortcut(new KeyboardEvent("keydown", { key: "k", metaKey: true })),
    ).toBe(false);
    expect(
      isJumpShortcut(
        new KeyboardEvent("keydown", {
          key: "j",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
    expect(isJumpShortcut(new KeyboardEvent("keydown", { key: "j" }))).toBe(
      false,
    );
    expect(["⌘J", "Ctrl J"]).toContain(jumpShortcutLabel());
  });
});
