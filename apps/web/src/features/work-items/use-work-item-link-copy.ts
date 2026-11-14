import { useEffect, useRef, useState } from "react";

import { writeClipboardText } from "@/lib/clipboard";

import { dashboardWorkItemPath } from "./work-item-routes";

export type WorkItemCopyState = "idle" | "copied" | "failed";

const feedbackDuration = 1200;

/**
 * Copies Work Item content and reports whether the clipboard accepted it, so a
 * refused write never reads as success.
 */
export function useWorkItemClipboardCopy() {
  const [state, setState] = useState<WorkItemCopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy(text: string) {
    window.clearTimeout(resetTimer.current);
    void writeClipboardText(text)
      .then(() => setState("copied"))
      .catch(() => setState("failed"))
      .finally(() => {
        resetTimer.current = window.setTimeout(
          () => setState("idle"),
          feedbackDuration,
        );
      });
  }

  return { copy, state };
}

/** Copies the Item's dashboard link through the shared clipboard feedback. */
export function useWorkItemLinkCopy(tenantId: string, workItemId: string) {
  const { copy, state } = useWorkItemClipboardCopy();
  return {
    copyLink: () => copy(dashboardWorkItemPath(tenantId, workItemId)),
    state,
  };
}
