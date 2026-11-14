import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { writeClipboardText } from "@/lib/clipboard";

import {
  pinnedMessagesMarkdown,
  type PinnedMessagesMarkdownPin,
} from "./pinned-messages-markdown";

/** Long enough to read, matching the other copy actions. */
const copiedFeedbackMs = 1200;

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies the pins the panel currently lists, filter included, as one Markdown
 * document and reports the clipboard's answer. Nothing listed means nothing
 * to copy, so the action stays disabled.
 */
export function PinnedMessagesCopyAction({
  origin,
  pins,
  roomName,
  tenantId,
}: {
  origin: string;
  pins: readonly PinnedMessagesMarkdownPin[];
  roomName: string;
  tenantId: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy() {
    window.clearTimeout(resetTimer.current);
    setState("idle");
    void writeClipboardText(
      pinnedMessagesMarkdown({ origin, pins, roomName, tenantId }),
    )
      .then(() => {
        setState("copied");
        resetTimer.current = window.setTimeout(
          () => setState("idle"),
          copiedFeedbackMs,
        );
      })
      .catch(() => setState("failed"));
  }

  return (
    <span className="flex items-center gap-1">
      {state === "copied" ? (
        <span className="text-2xs leading-4 text-app-muted" role="status">
          Copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="text-2xs leading-4 text-app-danger" role="alert">
          Copy failed
        </span>
      ) : null}
      <Button
        disabled={pins.length === 0}
        onClick={copy}
        size="compact"
        tone="ghost"
      >
        Copy pins
      </Button>
    </span>
  );
}
