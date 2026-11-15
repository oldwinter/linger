// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isShortcutKeyEvent } from "./keyboard-shortcut";

describe("isShortcutKeyEvent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function press(target: EventTarget, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "/",
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("claims a plain key on the page", () => {
    expect(isShortcutKeyEvent(press(document.body))).toBe(true);
  });

  it("leaves keys typed into a field to the field", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    document.body.append(input, textarea, select);

    expect(isShortcutKeyEvent(press(input))).toBe(false);
    expect(isShortcutKeyEvent(press(textarea))).toBe(false);
    expect(isShortcutKeyEvent(press(select))).toBe(false);
  });

  it("leaves keys pressed inside an editable region to the editor", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editor.append(inside);
    document.body.append(editor);

    expect(isShortcutKeyEvent(press(editor))).toBe(false);
    expect(isShortcutKeyEvent(press(inside))).toBe(false);
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

    expect(isShortcutKeyEvent(press(item))).toBe(false);
    expect(isShortcutKeyEvent(press(button))).toBe(false);
  });

  it("keeps out while any menu or dialog is open", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);

    expect(isShortcutKeyEvent(press(document.body))).toBe(false);
  });

  it("ignores every modifier-held chord", () => {
    expect(isShortcutKeyEvent(press(document.body, { ctrlKey: true }))).toBe(
      false,
    );
    expect(isShortcutKeyEvent(press(document.body, { metaKey: true }))).toBe(
      false,
    );
    expect(isShortcutKeyEvent(press(document.body, { altKey: true }))).toBe(
      false,
    );
    expect(isShortcutKeyEvent(press(document.body, { shiftKey: true }))).toBe(
      false,
    );
  });

  it("leaves an event another control already handled", () => {
    const handled = press(document.body);
    handled.preventDefault();

    expect(isShortcutKeyEvent(handled)).toBe(false);
  });

  it("leaves an IME composition in flight", () => {
    const composing = press(document.body);
    Object.defineProperty(composing, "isComposing", { value: true });

    expect(isShortcutKeyEvent(composing)).toBe(false);
  });
});
