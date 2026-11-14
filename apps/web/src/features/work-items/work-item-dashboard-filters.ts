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
};

export const WORK_ITEM_DASHBOARD_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;

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
  };
}

export function workItemDashboardFiltersSearch(
  filters: WorkItemDashboardFilters,
): string {
  const searchParams = new URLSearchParams();
  if (filters.room) searchParams.set("room", filters.room);
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
 * The filters that change the Dashboard list request. Room narrows the loaded
 * board instead, so its options still offer every source Room.
 */
export function workItemDashboardListFilterSearch(
  filters: WorkItemDashboardFilters,
): string {
  const searchParams = new URLSearchParams(
    workItemDashboardFiltersSearch(filters),
  );
  searchParams.delete("room");
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
