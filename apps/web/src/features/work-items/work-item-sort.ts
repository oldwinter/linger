import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WORK_ITEM_DASHBOARD_PRIORITIES } from "./work-item-dashboard-filters";

export type WorkItemDashboardSort = "updated" | "priority" | "newest";

/**
 * The board's own order. TeamHub lists a Tenant's Work Items by
 * `updated_at DESC, id DESC`, so the default sort leaves today's board as it is.
 */
export const DEFAULT_WORK_ITEM_DASHBOARD_SORT: WorkItemDashboardSort =
  "updated";

export const WORK_ITEM_DASHBOARD_SORTS = [
  DEFAULT_WORK_ITEM_DASHBOARD_SORT,
  "priority",
  "newest",
] as const;

/** Reads the `sort` URL value, falling back to the board's own order. */
export function createWorkItemDashboardSort(
  value: string | null,
): WorkItemDashboardSort {
  return (
    WORK_ITEM_DASHBOARD_SORTS.find((sort) => sort === value) ??
    DEFAULT_WORK_ITEM_DASHBOARD_SORT
  );
}

/** Keeps the sort in the URL only when it departs from the default. */
export function workItemDashboardSortSearch(
  filtersSearch: string,
  sort: WorkItemDashboardSort,
): string {
  const searchParams = new URLSearchParams(filtersSearch);
  if (sort !== DEFAULT_WORK_ITEM_DASHBOARD_SORT) {
    searchParams.set("sort", sort);
  }
  return searchParams.toString();
}

/** Orders the board's cards inside each column. */
export function sortWorkItems(
  items: readonly TeamHubWorkItem[],
  sort: WorkItemDashboardSort,
): TeamHubWorkItem[] {
  if (sort === "priority") {
    return [...items].sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        updatedFirst(a, b),
    );
  }
  if (sort === "newest") {
    return [...items].sort(
      (a, b) => newestFirst(a.created_at, b.created_at) || idLast(a, b),
    );
  }
  return [...items].sort(updatedFirst);
}

/** Higher rank is more urgent, following the contract's priority order. */
function priorityRank(priority: TeamHubWorkItem["priority"]) {
  return WORK_ITEM_DASHBOARD_PRIORITIES.indexOf(priority);
}

/** The Item known most recently first, then by id so equal times never swap. */
function updatedFirst(a: TeamHubWorkItem, b: TeamHubWorkItem) {
  return newestFirst(a.updated_at, b.updated_at) || idLast(a, b);
}

function newestFirst(a: string, b: string) {
  const delta = Date.parse(b) - Date.parse(a);
  return Number.isNaN(delta) ? 0 : delta;
}

function idLast(a: TeamHubWorkItem, b: TeamHubWorkItem) {
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}
