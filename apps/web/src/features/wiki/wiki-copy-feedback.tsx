import { useEffect, useRef, useState } from "react";

/** Long enough to read, matching the other copy actions. */
const copiedDurationMs = 1200;

export type WikiCopyState = "copied" | "failed" | undefined;

/**
 * The clipboard's answer for a Wiki copy action. A success clears itself after
 * a moment; a failure stays until the next attempt.
 */
export function useWikiCopyFeedback() {
  const [state, setState] = useState<WikiCopyState>();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  return {
    begin() {
      window.clearTimeout(resetTimer.current);
      setState(undefined);
    },
    copied() {
      window.clearTimeout(resetTimer.current);
      setState("copied");
      resetTimer.current = window.setTimeout(
        () => setState(undefined),
        copiedDurationMs,
      );
    },
    failed() {
      window.clearTimeout(resetTimer.current);
      setState("failed");
    },
    state,
  };
}

/** The shared "Copied" and "Copy failed" feedback beside a Wiki copy action. */
export function WikiCopyFeedback({ state }: { state: WikiCopyState }) {
  return (
    <>
      {state === "copied" ? (
        <span className="text-xs leading-4 text-app-muted" role="status">
          Copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          Copy failed
        </span>
      ) : null}
    </>
  );
}
