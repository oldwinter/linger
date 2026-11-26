import { Link01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast-store";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { translate } from "@/i18n/language";
import { writeClipboardText } from "@/lib/clipboard";

import { chatMessages } from "./chat.messages";
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
  const feedback = useCopyFeedback();

  function copy() {
    feedback.begin();
    const value = threadMarkdown(
      messages.map((message) => ({
        authorName:
          actorDisplayNames[message.author.id] ?? message.author.display_name,
        createdAt: message.created_at,
        message: message.raw_message,
      })),
    );
    void writeClipboardText(value).then(feedback.copied, feedback.failed);
  }

  return (
    <div className="flex items-center gap-2">
      <CopyFeedback state={feedback.state} />
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

/**
 * Copies the Thread's own Room URL, origin included, so the link opens from a
 * document or another app. Its feedback and accessible name stay separate from
 * Copy thread's, which copies the conversation itself.
 */
export function ThreadLinkCopyAction({ path }: { path?: string }) {
  const feedback = useCopyFeedback();

  function copy() {
    if (!path) return;
    feedback.begin();
    void writeClipboardText(
      new URL(path, window.location.origin).toString(),
    ).then(
      () => {
        feedback.copied();
        showToast({
          message: translate(chatMessages.linkCopied),
          tone: "success",
        });
      },
      () => {
        feedback.failed();
        showToast({
          message: translate(chatMessages.copyFailed),
          tone: "danger",
        });
      },
    );
  }

  return (
    <div className="flex items-center gap-2">
      <CopyFeedback state={feedback.state} />
      <Button
        aria-label="Copy link"
        className="!rounded-lg border-0 text-app-muted"
        disabled={!path}
        onClick={copy}
        size="compactIcon"
        title="Copy link"
        tone="ghost"
      >
        <Icon icon={Link01Icon} size={16} />
      </Button>
    </div>
  );
}

function useCopyFeedback() {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  return {
    begin() {
      window.clearTimeout(resetTimer.current);
      setState("idle");
    },
    copied() {
      window.clearTimeout(resetTimer.current);
      setState("copied");
      resetTimer.current = window.setTimeout(
        () => setState("idle"),
        copiedFeedbackMs,
      );
    },
    failed() {
      window.clearTimeout(resetTimer.current);
      setState("failed");
    },
    state,
  };
}

function CopyFeedback({ state }: { state: CopyState }) {
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
