import { useEffect, useEffectEvent } from "react";

function isMacLikePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Label beside Jump; Mac keyboards read ⌘J, everything else Ctrl J. */
export function jumpShortcutLabel() {
  return isMacLikePlatform() ? "⌘J" : "Ctrl J";
}

/**
 * Cmd/Ctrl+J opens Jump from anywhere, including the composer. An IME
 * composition in flight keeps the keystroke. Search keeps Cmd/Ctrl+K.
 */
export function isJumpShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.isComposing) return false;
  return event.key.toLowerCase() === "j";
}

export function useJumpShortcut(
  onOpen: () => void,
  options?: {
    canTrigger?: (event: KeyboardEvent) => boolean;
    enabled?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const open = useEffectEvent(onOpen);
  const canTrigger = useEffectEvent(
    (event: KeyboardEvent) => options?.canTrigger?.(event) ?? true,
  );
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (!isJumpShortcut(event)) return;
      if (!canTrigger(event)) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
