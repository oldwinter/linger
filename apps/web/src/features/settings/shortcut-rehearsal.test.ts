import { describe, expect, it } from "vitest";

import { playedShortcuts } from "./shortcut-rehearsal";

function press(
  key: string,
  modifiers: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {},
) {
  return playedShortcuts({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

describe("playedShortcuts", () => {
  it("names the search chord and a bare board key", () => {
    expect(press("k", { metaKey: true }).map((item) => item.action)).toEqual([
      "Open search",
    ]);
    expect(press("j").map((item) => item.action)).toEqual([
      "Select the next Work Item card",
    ]);
    expect(press("ArrowDown").map((item) => item.action)).toContain(
      "Select the next Work Item card",
    );
  });

  it("names every place Escape works", () => {
    const escape = press("Escape");
    expect(escape.length).toBeGreaterThan(1);
    expect(escape.map((item) => item.where)).toContain(
      "Works anywhere in a Room.",
    );
    expect(escape.every((item) => item.chord === "Escape")).toBe(true);
  });

  it("reads a shifted chord and a control chord", () => {
    expect(
      press("Enter", { shiftKey: true }).map((item) => item.action),
    ).toEqual(["Start a new line"]);
    expect(press("a", { ctrlKey: true }).map((item) => item.action)).toEqual([
      "Select everything in the Document",
    ]);
  });
});
