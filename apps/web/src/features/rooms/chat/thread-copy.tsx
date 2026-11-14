import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";

import { threadMarkdown } from "./thread-markdown";

/** Long enough to read, matching the other copy actions. */
const copiedFeedbackMs = 1200;

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies the Thread's messages as one Markdown document and reports the
 * clipboard's answer, so a refused write never reads as success. With no
 * messages there is nothing to copy, so the action stays disabled.
 */
export function ThreadCopyAction({
  actorDisplayNames,
  messages,
}: {
  /** The name each row shows, which Copy as quote also uses. */
  actorDisplayNames: Record<string, string>;
  messages: readonly TeamHubMessage[];
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy() {
    window.clearTimeout(resetTimer.current);
    setState("idle");
    const value = threadMarkdown(
      messages.map((message) => ({
        authorName:
          actorDisplayNames[message.author.id] ?? message.author.display_name,
        createdAt: message.created_at,
        message: message.raw_message,
      })),
    );
    void writeClipboardText(value)
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
    <div className="flex items-center gap-2">
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
      <Button
        disabled={messages.length === 0}
        onClick={copy}
        size="compact"
        tone="ghost"
      >
        Copy thread
      </Button>
    </div>
  );
}
