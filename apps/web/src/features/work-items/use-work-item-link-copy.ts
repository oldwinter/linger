import { useEffect, useRef, useState } from "react";

import { writeClipboardText } from "@/lib/clipboard";

import { dashboardWorkItemPath } from "./work-item-routes";

export type WorkItemLinkCopyState = "idle" | "copied" | "failed";

const feedbackDuration = 1200;

/**
 * Copies the Item's dashboard link and reports whether the clipboard accepted
 * it, so a refused write never reads as success.
 */
export function useWorkItemLinkCopy(tenantId: string, workItemId: string) {
  const [state, setState] = useState<WorkItemLinkCopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copyLink() {
    window.clearTimeout(resetTimer.current);
    void writeClipboardText(dashboardWorkItemPath(tenantId, workItemId))
      .then(() => setState("copied"))
      .catch(() => setState("failed"))
      .finally(() => {
        resetTimer.current = window.setTimeout(
          () => setState("idle"),
          feedbackDuration,
        );
      });
  }

  return { copyLink, state };
}
