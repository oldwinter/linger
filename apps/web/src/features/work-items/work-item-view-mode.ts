export type WorkItemViewMode = "board" | "list";

export const DEFAULT_WORK_ITEM_VIEW_MODE: WorkItemViewMode = "board";

/** Reads the Dashboard view mode from a URL query parameter, defaulting to board. */
export function parseWorkItemViewMode(
  value: string | null | undefined,
): WorkItemViewMode {
  return value === "list" ? "list" : "board";
}

/** Appends or removes `view=list` on a serialized Dashboard query string. */
export function workItemDashboardViewSearch(
  search: string,
  viewMode: WorkItemViewMode,
): string {
  const params = new URLSearchParams(search);
  if (viewMode === "list") {
    params.set("view", "list");
  } else {
    params.delete("view");
  }
  return params.toString();
}
