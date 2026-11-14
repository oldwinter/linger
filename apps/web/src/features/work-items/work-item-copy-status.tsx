import { cn } from "@/lib/cn";

import type { WorkItemLinkCopyState } from "./use-work-item-link-copy";

/**
 * The copy outcome, anchored under the control that copied. Failure is spelled
 * out rather than left to an icon so it cannot pass for success.
 */
export function WorkItemCopyStatus({
  state,
}: {
  state: WorkItemLinkCopyState;
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
      {state === "copied" ? "Link copied" : "Copy failed"}
    </span>
  );
}
