import { cn } from "@/lib/cn";

import type { WorkItemCopyState } from "./use-work-item-copy";

/**
 * An action's outcome, anchored under the control that ran. Failure is spelled
 * out rather than left to an icon so it cannot pass for success.
 */
export function WorkItemCopyStatus({
  copiedLabel = "Link copied",
  failedLabel = "Copy failed",
  state,
}: {
  /** What the successful action wrote; the failure line is shared. */
  copiedLabel?: string;
  /** What the action says when it was refused; copies say so by default. */
  failedLabel?: string;
  state: WorkItemCopyState;
}) {
  if (state === "idle") return null;
  return (
    <span
      className={cn(
        "absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-card px-1.5 py-0.5 text-[12px] leading-4 shadow-outline",
        state === "failed" ? "text-app-danger" : "text-app-body",
      )}
      role="status"
    >
      {state === "copied" ? copiedLabel : failedLabel}
    </span>
  );
}
