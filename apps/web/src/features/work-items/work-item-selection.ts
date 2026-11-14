import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

/** The selection after toggling one card. */
export function toggleWorkItemSelection(
  selectedIds: ReadonlySet<string>,
  workItemId: string,
): ReadonlySet<string> {
  const next = new Set(selectedIds);
  if (next.has(workItemId)) next.delete(workItemId);
  else next.add(workItemId);
  return next;
}

/**
 * The selection narrowed to the cards the board shows, so the count always
 * describes visible cards. The same set comes back when nothing was dropped,
 * which lets the caller store it without another render.
 */
export function retainVisibleWorkItemSelection(
  selectedIds: ReadonlySet<string>,
  visibleIds: readonly string[],
): ReadonlySet<string> {
  if (selectedIds.size === 0) return selectedIds;
  const visible = new Set(visibleIds);
  const retained = [...selectedIds].filter((id) => visible.has(id));
  if (retained.length === selectedIds.size) return selectedIds;
  return new Set(retained);
}

/** Every card the board shows, never one a filter or collapsed column hid. */
export function selectAllVisibleWorkItems(
  visibleIds: readonly string[],
): ReadonlySet<string> {
  return new Set(visibleIds);
}

/** Whether the selection already holds every card the board shows. */
export function hasSelectedAllVisibleWorkItems(
  selectedIds: ReadonlySet<string>,
  visibleIds: readonly string[],
): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
}

export interface WorkItemArchiveOutcome {
  /** Whether any Item failed; the message says which. */
  failed: boolean;
  message: string;
}

/**
 * What the archive reported, counting only what TeamHub accepted. A partial run
 * names the Items that failed, which stay selected for another try.
 */
export function describeWorkItemArchiveOutcome(
  archived: number,
  failed: readonly TeamHubWorkItem[],
): WorkItemArchiveOutcome {
  if (failed.length === 0) {
    return { failed: false, message: `Archived ${workItemCount(archived)}.` };
  }
  return {
    failed: true,
    message: `Archived ${archived} of ${workItemCount(archived + failed.length)}. Failed: ${failed
      .map((item) => item.title)
      .join(", ")}.`,
  };
}

function workItemCount(count: number) {
  return count === 1 ? "1 item" : `${count} items`;
}
