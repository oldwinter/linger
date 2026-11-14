import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

export type WorkItemDashboardPriority = TeamHubWorkItem["priority"];
export type WorkItemDashboardExecutionStatus = NonNullable<
  TeamHubWorkItem["task_execution"]
>["status"];
export type WorkItemDashboardAssignment = "all" | "mine" | "unassigned";

export interface WorkItemDashboardFilters {
  room: string;
  priority: WorkItemDashboardPriority | "";
  assignment: WorkItemDashboardAssignment;
  execution: WorkItemDashboardExecutionStatus | "";
  /**
   * Archived Work Items stay in their lifecycle columns, so this filter
   * includes them in the board instead of replacing it with an archive list.
   */
  archived: boolean;
  /**
   * The typed title query, kept as written so a trailing space survives until
   * the next word; matching splits it into words. Blank text is no filter.
   */
  text: string;
}

export interface WorkItemDashboardListQuery {
  archived?: true;
  assignee_actor_id?: string;
  execution_status?: WorkItemDashboardExecutionStatus;
  priority?: WorkItemDashboardPriority;
}

export const EMPTY_WORK_ITEM_DASHBOARD_FILTERS: WorkItemDashboardFilters = {
  archived: false,
  assignment: "all",
  execution: "",
  priority: "",
  room: "",
  text: "",
};

export const WORK_ITEM_DASHBOARD_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const WORK_ITEM_DASHBOARD_PRIORITY_LABELS: Record<
  WorkItemDashboardPriority,
  string
> = {
  high: "High",
  low: "Low",
  medium: "Medium",
  urgent: "Urgent",
};

export const WORK_ITEM_DASHBOARD_EXECUTION_STATUSES = [
  "running",
  "waiting_for_approval",
  "idle",
  "failed",
  "canceled",
] as const;

export const WORK_ITEM_DASHBOARD_ASSIGNMENTS = [
  "all",
  "mine",
  "unassigned",
] as const;

export function createWorkItemDashboardFilters(
  searchParams: URLSearchParams,
): WorkItemDashboardFilters {
  const text = searchParams.get("q") ?? "";
  return {
    archived: searchParams.get("archived") === "true",
    assignment:
      oneOf(searchParams.get("assignment"), WORK_ITEM_DASHBOARD_ASSIGNMENTS) ??
      "all",
    execution:
      oneOf(
        searchParams.get("execution"),
        WORK_ITEM_DASHBOARD_EXECUTION_STATUSES,
      ) ?? "",
    priority:
      oneOf(searchParams.get("priority"), WORK_ITEM_DASHBOARD_PRIORITIES) ?? "",
    room: searchParams.get("room")?.trim() ?? "",
    text: text.trim() ? text : "",
  };
}

export function workItemDashboardFiltersSearch(
  filters: WorkItemDashboardFilters,
): string {
  const searchParams = new URLSearchParams();
  if (filters.room) searchParams.set("room", filters.room);
  if (filters.text.trim()) searchParams.set("q", filters.text);
  if (filters.priority) searchParams.set("priority", filters.priority);
  if (filters.assignment !== "all") {
    searchParams.set("assignment", filters.assignment);
  }
  if (filters.execution) searchParams.set("execution", filters.execution);
  if (filters.archived) searchParams.set("archived", "true");
  return searchParams.toString();
}

export function hasWorkItemDashboardFilters(
  filters: WorkItemDashboardFilters,
): boolean {
  return workItemDashboardFiltersSearch(filters) !== "";
}

/**
 * The Work Items whose title holds every word of the query, case-insensitively.
 * Descriptions, comments, and Room names stay out, so the board never matches
 * text the card does not show.
 */
export function matchesWorkItemText(
  item: Pick<TeamHubWorkItem, "title">,
  text: string,
): boolean {
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return true;
  const title = item.title.toLowerCase();
  return words.every((word) => title.includes(word));
}

/**
 * The filters that change the Dashboard list request. Room and the title query
 * narrow the loaded board instead, so its options still offer every source
 * Room and typing never refetches.
 */
export function workItemDashboardListFilterSearch(
  filters: WorkItemDashboardFilters,
): string {
  const searchParams = new URLSearchParams(
    workItemDashboardFiltersSearch(filters),
  );
  searchParams.delete("room");
  searchParams.delete("q");
  return searchParams.toString();
}

export function workItemDashboardListQuery(
  filters: WorkItemDashboardFilters,
  currentActorId?: string,
): WorkItemDashboardListQuery {
  const query: WorkItemDashboardListQuery = {};
  if (filters.archived) query.archived = true;
  if (filters.assignment === "mine" && currentActorId) {
    query.assignee_actor_id = currentActorId;
  }
  if (filters.execution) query.execution_status = filters.execution;
  if (filters.priority) query.priority = filters.priority;
  return query;
}

/** The Human Actor of the active Tenant, which "Mine" means. */
export function currentDashboardActorId(
  identity: { actors: Array<{ id: string; tenant_id: string }> },
  tenantId: string,
): string | undefined {
  return identity.actors.find((actor) => actor.tenant_id === tenantId)?.id;
}

function oneOf<T extends string>(
  value: string | null,
  options: readonly T[],
): T | undefined {
  return options.find((option) => option === value);
}
