// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  isWorkItemBoardKeyEvent,
  nextWorkItemCardId,
  workItemBoardMoveForKey,
} from "./work-item-board-keyboard";

const cards = ["card-a", "card-b", "card-c"];

describe("nextWorkItemCardId", () => {
  it("moves forward one card at a time", () => {
    expect(nextWorkItemCardId(cards, "card-a", "next")).toBe("card-b");
    expect(nextWorkItemCardId(cards, "card-b", "next")).toBe("card-c");
  });

  it("moves backward one card at a time", () => {
    expect(nextWorkItemCardId(cards, "card-c", "previous")).toBe("card-b");
    expect(nextWorkItemCardId(cards, "card-b", "previous")).toBe("card-a");
  });

  it("starts at the first card when nothing is marked, either way", () => {
    expect(nextWorkItemCardId(cards, undefined, "next")).toBe("card-a");
    expect(nextWorkItemCardId(cards, undefined, "previous")).toBe("card-a");
  });

  it("stops at each end instead of wrapping", () => {
    expect(nextWorkItemCardId(cards, "card-c", "next")).toBe("card-c");
    expect(nextWorkItemCardId(cards, "card-a", "previous")).toBe("card-a");
  });

  it("starts over at the first card when the mark is stale", () => {
    expect(nextWorkItemCardId(cards, "card-gone", "previous")).toBe("card-a");
  });

  it("returns no card for an empty board", () => {
    expect(nextWorkItemCardId([], undefined, "next")).toBeUndefined();
  });
});

describe("workItemBoardMoveForKey", () => {
  it("reads j and the down arrow as forward", () => {
    expect(workItemBoardMoveForKey("j")).toBe("next");
    expect(workItemBoardMoveForKey("ArrowDown")).toBe("next");
  });

  it("reads k and the up arrow as backward", () => {
    expect(workItemBoardMoveForKey("k")).toBe("previous");
    expect(workItemBoardMoveForKey("ArrowUp")).toBe("previous");
  });

  it("leaves every other key alone", () => {
    expect(workItemBoardMoveForKey("Enter")).toBeUndefined();
    expect(workItemBoardMoveForKey("Escape")).toBeUndefined();
    expect(workItemBoardMoveForKey("J")).toBeUndefined();
    expect(workItemBoardMoveForKey("x")).toBeUndefined();
  });
});

describe("isWorkItemBoardKeyEvent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function press(target: EventTarget, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "j",
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("claims a plain key on the page", () => {
    expect(isWorkItemBoardKeyEvent(press(document.body))).toBe(true);
  });

  it("leaves keys typed into a field to the field", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);

    expect(isWorkItemBoardKeyEvent(press(input))).toBe(false);
    expect(isWorkItemBoardKeyEvent(press(textarea))).toBe(false);
  });

  it("leaves keys pressed inside an editable region to the editor", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);

    expect(isWorkItemBoardKeyEvent(press(editor))).toBe(false);
  });

  it("leaves keys pressed inside a menu or dialog to it", () => {
    const item = document.createElement("button");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.append(item);
    const button = document.createElement("button");
    const dialog = document.createElement("dialog");
    dialog.append(button);
    document.body.append(menu, dialog);

    expect(isWorkItemBoardKeyEvent(press(item))).toBe(false);
    expect(isWorkItemBoardKeyEvent(press(button))).toBe(false);
  });

  it("keeps out while any menu or dialog is open", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);

    expect(isWorkItemBoardKeyEvent(press(document.body))).toBe(false);
  });

  it("ignores every modifier-held chord", () => {
    expect(
      isWorkItemBoardKeyEvent(press(document.body, { ctrlKey: true })),
    ).toBe(false);
    expect(
      isWorkItemBoardKeyEvent(press(document.body, { metaKey: true })),
    ).toBe(false);
    expect(
      isWorkItemBoardKeyEvent(press(document.body, { altKey: true })),
    ).toBe(false);
    expect(
      isWorkItemBoardKeyEvent(press(document.body, { shiftKey: true })),
    ).toBe(false);
  });

  it("leaves an event another control already handled", () => {
    const handled = press(document.body);
    handled.preventDefault();

    expect(isWorkItemBoardKeyEvent(handled)).toBe(false);
  });

  it("leaves an IME composition in flight", () => {
    const composing = press(document.body);
    Object.defineProperty(composing, "isComposing", { value: true });

    expect(isWorkItemBoardKeyEvent(composing)).toBe(false);
  });
});
