import type {
  TeamHubWorkItem,
  TeamHubWorkItemPriority,
} from "@/features/teamhub/teamhub-types";
import { translate, type Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { workItemsMessages as m } from "./work-items.messages";

const workItemStateMessages: Record<
  TeamHubWorkItem["state"],
  Message<string>
> = {
  in_progress: m.stateInProgress,
  open: m.stateOpen,
  resolved: m.stateResolved,
};

const workItemPriorityMessages: Record<
  TeamHubWorkItemPriority,
  Message<string>
> = {
  high: m.priorityHigh,
  low: m.priorityLow,
  medium: m.priorityMedium,
  urgent: m.priorityUrgent,
};

const workItemResolutionMessages: Record<
  NonNullable<TeamHubWorkItem["resolution"]>,
  Message<string>
> = {
  completed: m.resolutionCompleted,
  duplicate: m.resolutionDuplicate,
  failed: m.resolutionFailed,
  not_planned: m.resolutionNotPlanned,
};

export const workItemStateLabels: Record<TeamHubWorkItem["state"], string> = {
  in_progress: "In progress",
  open: "Open",
  resolved: "Resolved",
};

/** The state chip's label, with the resolution that closed a resolved Item. */
export function workItemStateLabel(
  item: Pick<TeamHubWorkItem, "resolution" | "state">,
  t: Translate = translate,
) {
  const state = t(workItemStateMessages[item.state]);
  if (!item.resolution) return state;
  return `${state} · ${t(workItemResolutionMessages[item.resolution])}`;
}

/** Every priority TeamHub accepts, in the order the app offers them. */
export const workItemPriorities: readonly TeamHubWorkItemPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

/** The priority as the board's chip renders it. */
export function workItemPriorityLabel(
  priority: TeamHubWorkItemPriority,
  t: Translate = translate,
) {
  return t(workItemPriorityMessages[priority]);
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
