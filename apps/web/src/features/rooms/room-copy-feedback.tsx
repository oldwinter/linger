import { useEffect, useRef, useState } from "react";

export type RoomCopyState = "idle" | "copied" | "failed";

/** Long enough to read, matching the message menu's Copied tick. */
const ROOM_COPY_COPIED_MS = 1200;

/**
 * The clipboard's answer for a Room copy action. A success clears itself after
 * a moment; a failure stays until the next attempt.
 */
export function useRoomClipboardCopy(text: () => string) {
  const [state, setState] = useState<RoomCopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);
  function copy() {
    window.clearTimeout(resetTimer.current);
    setState("idle");
    void import("@/lib/clipboard")
      .then(({ writeClipboardText }) => writeClipboardText(text()))
      .then(() => {
        setState("copied");
        resetTimer.current = window.setTimeout(
          () => setState("idle"),
          ROOM_COPY_COPIED_MS,
        );
      })
      .catch(() => setState("failed"));
  }
  return { copy, state };
}

/** A refused write keeps saying so until the next attempt. */
export function RoomCopyStatus({ state }: { state: RoomCopyState }) {
  if (state === "copied")
    return (
      <span className="text-xs leading-4 text-app-muted" role="status">
        Copied
      </span>
    );
  if (state === "failed")
    return (
      <span className="text-xs leading-4 text-app-danger" role="alert">
        Copy failed
      </span>
    );
  return null;
}
