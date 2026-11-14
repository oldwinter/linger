import { useEffect, useRef, useState } from "react";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";

import { workItemMarkdown } from "./work-item-markdown";
import {
  dashboardWorkItemPath,
  dashboardWorkItemUrl,
} from "./work-item-routes";

export type WorkItemCopyState = "idle" | "copied" | "failed";

export interface WorkItemCopy {
  /** What the last successful copy wrote; undefined until something is copied. */
  copiedLabel: string | undefined;
  copyLink: () => void;
  copyMarkdown: () => void;
  state: WorkItemCopyState;
}

interface WorkItemCopyFeedback {
  /** Which text was copied, since one menu offers both actions. */
  label: string;
  state: Exclude<WorkItemCopyState, "idle">;
}

const feedbackDuration = 1200;

/**
 * Copies the Item as its dashboard link or as Markdown and reports whether the
 * clipboard accepted it, so a refused write never reads as success.
 */
export function useWorkItemCopy(
  tenantId: string,
  item: TeamHubWorkItem,
): WorkItemCopy {
  const [feedback, setFeedback] = useState<WorkItemCopyFeedback>();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy(text: string, label: string) {
    window.clearTimeout(resetTimer.current);
    void writeClipboardText(text)
      .then(() => setFeedback({ label, state: "copied" }))
      .catch(() => setFeedback({ label, state: "failed" }))
      .finally(() => {
        resetTimer.current = window.setTimeout(
          () => setFeedback(undefined),
          feedbackDuration,
        );
      });
  }

  return {
    copiedLabel: feedback?.label,
    copyLink: () =>
      copy(dashboardWorkItemPath(tenantId, item.id), "Link copied"),
    copyMarkdown: () =>
      copy(
        workItemMarkdown({
          item,
          link: dashboardWorkItemUrl(tenantId, item.id),
        }),
        "Markdown copied",
      ),
    state: feedback?.state ?? "idle",
  };
}
