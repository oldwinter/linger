// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it, vi } from "vitest";

import {
  SHARED_WORD_MS,
  bindSharedPassage,
  caretOutsideSharedWord,
  liveActorIds,
} from "./shared-passage";

describe("bindSharedPassage", () => {
  it("releases the binding after the editor view unmounts", () => {
    const editor = BlockNoteEditor.create();
    const host = document.createElement("div");
    document.body.appendChild(host);
    editor.mount(host);
    const awareness = {
      clientID: 1,
      getStates: () => new Map(),
      off: vi.fn(),
      on: vi.fn(),
    };
    const release = bindSharedPassage(() => editor.prosemirrorView, awareness);

    editor.unmount();
    try {
      expect(release).not.toThrow();
      expect(awareness.off).toHaveBeenCalledWith(
        "change",
        awareness.on.mock.calls[0]?.[1],
      );
    } finally {
      host.remove();
    }
  });

  it("removes listeners from their original DOM when the editor remounts", () => {
    const editor = BlockNoteEditor.create();
    const host = document.createElement("div");
    const remountedHost = document.createElement("div");
    document.body.append(host, remountedHost);
    editor.mount(host);
    const dom = editor.prosemirrorView.dom;
    const getView = vi.fn(() => editor.prosemirrorView);
    const release = bindSharedPassage(getView, {
      clientID: 1,
      getStates: () => new Map(),
      off: () => undefined,
      on: () => undefined,
    });

    editor.unmount();
    editor.mount(remountedHost);
    try {
      expect(editor.prosemirrorView.dom).not.toBe(dom);
      release();
      getView.mockClear();
      dom.dispatchEvent(
        new InputEvent("beforeinput", {
          data: "a",
          inputType: "insertText",
        }),
      );
      dom.dispatchEvent(new CompositionEvent("compositionstart"));
      expect(getView).not.toHaveBeenCalled();
    } finally {
      editor.unmount();
      host.remove();
      remountedHost.remove();
    }
  });

  it("cancels deferred attachment when the binding is released", () => {
    vi.useFakeTimers();
    const getView = vi.fn<() => EditorView | null>(() => null);
    const release = bindSharedPassage(getView, {
      clientID: 1,
      getStates: () => new Map(),
      off: () => undefined,
      on: () => undefined,
    });
    try {
      release();
      getView.mockClear();
      vi.runAllTimers();
      expect(getView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("caretOutsideSharedWord", () => {
  it("places the next character after a word someone else is in", () => {
    expect(caretOutsideSharedWord("hello world", 2, [4])).toBe(5);
    expect(caretOutsideSharedWord("hello world", 5, [4])).toBeUndefined();
    expect(caretOutsideSharedWord("hello world", 2, [8])).toBeUndefined();
    expect(caretOutsideSharedWord("hello world", 5, [8])).toBeUndefined();
  });
});

describe("liveActorIds", () => {
  it("keeps only the people who moved just now", () => {
    const now = 10_000;
    expect(
      liveActorIds(
        new Map([
          ["ada", now - 500],
          ["sam", now - SHARED_WORD_MS - 1],
        ]),
        now,
      ),
    ).toEqual(new Set(["ada"]));
  });
});
