import type {
  TeamHubWorkItem,
  TeamHubWorkItemPriority,
} from "@/features/teamhub/teamhub-types";

export const workItemStateLabels: Record<TeamHubWorkItem["state"], string> = {
  in_progress: "In progress",
  open: "Open",
  resolved: "Resolved",
};

/** The state chip's label, with the resolution that closed a resolved Item. */
export function workItemStateLabel(
  item: Pick<TeamHubWorkItem, "resolution" | "state">,
) {
  if (!item.resolution) return workItemStateLabels[item.state];
  return `${workItemStateLabels[item.state]} · ${resolutionLabel(item.resolution)}`;
}

/** Every priority TeamHub accepts, in the order the app offers them. */
export const workItemPriorities: readonly TeamHubWorkItemPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

/** The priority as the board's chip renders it. */
export function workItemPriorityLabel(priority: TeamHubWorkItemPriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** Semantic priority badge classes shared between board cards and peek. */
export function workItemPriorityBadgeClassName(
  priority: TeamHubWorkItemPriority,
): string {
  switch (priority) {
    case "urgent":
      return "border-(--app-status-danger-border) bg-(--app-status-danger-surface) text-(--app-status-danger-text)";
    case "high":
      return "border-(--app-status-warning-border) bg-(--app-status-warning-surface) text-(--app-status-warning-text)";
    case "medium":
    case "low":
      return "border-app-border-strong bg-transparent text-app-muted";
  }
}

function resolutionLabel(
  resolution: NonNullable<TeamHubWorkItem["resolution"]>,
) {
  return resolution === "not_planned"
    ? "Not planned"
    : resolution.charAt(0).toUpperCase() + resolution.slice(1);
}
