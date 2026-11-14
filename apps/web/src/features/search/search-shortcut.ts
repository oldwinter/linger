import { useEffect, useEffectEvent } from "react";

export function isMacLikePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Label shown next to the Search entry; Mac keyboards read ⌘K, everything else Ctrl K. */
export function searchShortcutLabel() {
  return isMacLikePlatform() ? "⌘K" : "Ctrl K";
}

/**
 * Cmd/Ctrl+K opens global search from anywhere, including the composer and
 * the Document editor. An IME composition in flight keeps the keystroke.
 */
export function isGlobalSearchShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.isComposing) return false;
  return event.key.toLowerCase() === "k";
}

export function useGlobalSearchShortcut(onOpen: () => void) {
  const open = useEffectEvent(onOpen);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isGlobalSearchShortcut(event)) return;
      // Capture phase plus stopPropagation: editors that bind the same key
      // (the Markdown editor's link command) never see it, so search wins.
      event.preventDefault();
      event.stopPropagation();
      open();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

/**
 * Cmd/Ctrl+F opens search narrowed to the open Room, where the browser's find
 * bar would otherwise open. A field, an editor, or an open dialog owns the
 * keystroke pressed inside it, and so does an editor that already handled it.
 */
export function isRoomSearchShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key.toLowerCase() !== "f") return false;
  if (event.defaultPrevented) return false;
  return !keystrokeHasOwner(event.target);
}

function keystrokeHasOwner(target: EventTarget | null) {
  if (document.querySelector("dialog[open]")) return true;
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) !== null
  );
}

/**
 * Room-scoped Cmd/Ctrl+F. Unlike Cmd/Ctrl+K it listens in the bubble phase, so
 * an editor that owns the key handles it first and the Room takes only what is
 * left; the browser's find bar is prevented only when the Room opens search.
 */
export function useRoomSearchShortcut(onOpen: () => void, enabled = true) {
  const open = useEffectEvent(onOpen);
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!isRoomSearchShortcut(event)) return;
      event.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
