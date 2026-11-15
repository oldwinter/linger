import { useEffect, useRef, useState } from "react";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";

import { workItemMarkdown } from "./work-item-markdown";
import {
  dashboardWorkItemPath,
  dashboardWorkItemUrl,
} from "./work-item-routes";

export type WorkItemCopyState = "idle" | "copied" | "failed";

export interface WorkItemClipboardCopy {
  /** What the last successful copy wrote; undefined until something is copied. */
  copiedLabel: string | undefined;
  copy: (text: string, label?: string) => void;
  state: WorkItemCopyState;
}

export interface WorkItemCopy extends WorkItemClipboardCopy {
  copyLink: () => void;
  copyMarkdown: () => void;
}

interface WorkItemCopyFeedback {
  /** Which text was copied, since one control may offer several actions. */
  label: string;
  state: Exclude<WorkItemCopyState, "idle">;
}

const feedbackDuration = 1200;
const defaultCopiedLabel = "Copied";

/**
 * Copies text and reports whether the clipboard accepted it, so a refused write
 * never reads as success.
 */
export function useWorkItemClipboardCopy(): WorkItemClipboardCopy {
  const [feedback, setFeedback] = useState<WorkItemCopyFeedback>();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy(text: string, label: string = defaultCopiedLabel) {
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
    copy,
    state: feedback?.state ?? "idle",
  };
}

/**
 * Copies the Item as its dashboard link or as Markdown, naming which one the
 * confirmation refers to.
 */
export function useWorkItemCopy(
  tenantId: string,
  item: TeamHubWorkItem,
): WorkItemCopy {
  const { copy, copiedLabel, state } = useWorkItemClipboardCopy();

  return {
    copiedLabel,
    copy,
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
    state,
  };
}
