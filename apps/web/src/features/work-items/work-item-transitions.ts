import { useMutation, useQueryClient } from "@tanstack/react-query";

import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubWorkItem,
  TeamHubWorkItemPage,
} from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";

import {
  tenantWorkItemTargetQueryKey,
  tenantWorkItemTimelineQueryKey,
  tenantWorkItemsDashboardQueryPrefix,
} from "./work-item-queries";
import { workItemsViewMessages as vm } from "./work-items-view.messages";

export type DashboardColumnId = "todo" | "in-progress" | "done" | "closed";

export interface WorkItemTransitionSpec {
  resolution?: NonNullable<TeamHubWorkItem["resolution"]>;
  state: TeamHubWorkItem["state"];
}

export interface DrawerStatusOption {
  label: string;
  resolution?: NonNullable<TeamHubWorkItem["resolution"]>;
  state: TeamHubWorkItem["state"];
  value: string;
}

/** Maps a Work Item's state and resolution to its Dashboard column. */
export function dashboardColumnFor(item: TeamHubWorkItem): DashboardColumnId {
  if (item.state === "open") return "todo";
  if (item.state === "in_progress") return "in-progress";
  return item.resolution === "completed" ? "done" : "closed";
}

/**
 * Returns the TeamHub transition payload when dragging `item` onto `target`, or
 * `null` when TeamHub does not permit the move (managed Tasks, same column, or
 * resolved items dragged directly to non-Todo columns).
 */
export function workItemTransitionForColumn(
  item: TeamHubWorkItem,
  target: DashboardColumnId,
): WorkItemTransitionSpec | null {
  if (item.task_execution) return null;
  if (dashboardColumnFor(item) === target) return null;
  if (item.state === "resolved") {
    return target === "todo" ? { state: "open" } : null;
  }
  switch (target) {
    case "todo":
      return { state: "open" };
    case "in-progress":
      return { state: "in_progress" };
    case "done":
      return { resolution: "completed", state: "resolved" };
    case "closed":
      return { resolution: "not_planned", state: "resolved" };
  }
}

/** Encodes a state + optional resolution into a stable `<Select>` option value. */
export function drawerStatusKey(
  state: TeamHubWorkItem["state"],
  resolution?: TeamHubWorkItem["resolution"],
): string {
  return state === "resolved" ? `${state}:${resolution ?? "completed"}` : state;
}

/**
 * Builds the status choices the inline drawer editor offers: the Item's current
 * status plus every transition TeamHub accepts from its current state.
 */
export function drawerStatusOptions(
  item: TeamHubWorkItem,
  t: Translate,
): DrawerStatusOption[] {
  const currentKey = drawerStatusKey(item.state, item.resolution);
  const currentOption: DrawerStatusOption = {
    label: statusOptionLabel(item.state, item.resolution, t),
    resolution: item.resolution,
    state: item.state,
    value: currentKey,
  };
  if (item.task_execution) return [currentOption];
  const candidates: WorkItemTransitionSpec[] =
    item.state === "open"
      ? [
          { state: "open" },
          { state: "in_progress" },
          { resolution: "completed", state: "resolved" },
          { resolution: "not_planned", state: "resolved" },
        ]
      : item.state === "in_progress"
        ? [
            { state: "open" },
            { state: "in_progress" },
            { resolution: "completed", state: "resolved" },
            { resolution: "not_planned", state: "resolved" },
          ]
        : [
            { resolution: item.resolution, state: "resolved" },
            { state: "open" },
          ];

  const seen = new Set<string>();
  const options: DrawerStatusOption[] = [];
  for (const candidate of candidates) {
    const value = drawerStatusKey(candidate.state, candidate.resolution);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      label: statusOptionLabel(candidate.state, candidate.resolution, t),
      resolution: candidate.resolution,
      state: candidate.state,
      value,
    });
  }
  return options;
}

function statusOptionLabel(
  state: TeamHubWorkItem["state"],
  resolution: TeamHubWorkItem["resolution"] | undefined,
  t: Translate,
): string {
  if (state === "open") return t(vm.statusTodo);
  if (state === "in_progress") return t(vm.statusInProgress);
  if (resolution === "completed" || !resolution) return t(vm.statusDone);
  if (resolution === "failed") return t(vm.statusClosedFailed);
  if (resolution === "duplicate") return t(vm.statusClosedDuplicate);
  return t(vm.statusClosedNotPlanned);
}

export interface BoardTransitionVariables {
  expectedVersion: number;
  resolution?: NonNullable<TeamHubWorkItem["resolution"]>;
  state: TeamHubWorkItem["state"];
  workItemId: string;
}

interface BoardTransitionContext {
  previousDashboards: Array<
    readonly [readonly unknown[], TeamHubWorkItemPage | undefined]
  >;
  previousTarget: TeamHubWorkItem | undefined;
  workItemId: string;
}

/**
 * Transitions any Work Item on the Dashboard board with optimistic column
 * placement and full rollback on failure.
 */
export function useBoardWorkItemTransition(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const dashboardPrefix = tenantWorkItemsDashboardQueryPrefix(tenantId);

  return useMutation<
    TeamHubWorkItem,
    Error,
    BoardTransitionVariables,
    BoardTransitionContext
  >({
    mutationFn: (input: BoardTransitionVariables) =>
      teamHubData(
        client.api.POST("/v0/work-items/{workItemId}/transitions", {
          body: {
            expected_version: input.expectedVersion,
            resolution: input.resolution,
            state: input.state,
          },
          params: {
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
            path: { workItemId: input.workItemId },
          },
        }),
      ),
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const [queryKey, data] of context.previousDashboards) {
        queryClient.setQueryData(queryKey, data);
      }
      if (context.previousTarget !== undefined) {
        queryClient.setQueryData(
          tenantWorkItemTargetQueryKey(tenantId, context.workItemId),
          context.previousTarget,
        );
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: dashboardPrefix });
      const previousDashboards =
        queryClient.getQueriesData<TeamHubWorkItemPage>({
          queryKey: dashboardPrefix,
        });
      const targetKey = tenantWorkItemTargetQueryKey(
        tenantId,
        variables.workItemId,
      );
      const previousTarget =
        queryClient.getQueryData<TeamHubWorkItem>(targetKey);
      const patchItem = (item: TeamHubWorkItem): TeamHubWorkItem =>
        item.id === variables.workItemId
          ? {
              ...item,
              resolution:
                variables.state === "resolved"
                  ? variables.resolution
                  : undefined,
              state: variables.state,
            }
          : item;
      for (const [queryKey, page] of previousDashboards) {
        if (!page) continue;
        queryClient.setQueryData<TeamHubWorkItemPage>(queryKey, {
          ...page,
          items: page.items.map(patchItem),
        });
      }
      if (previousTarget) {
        queryClient.setQueryData<TeamHubWorkItem>(
          targetKey,
          patchItem(previousTarget),
        );
      }
      return {
        previousDashboards,
        previousTarget,
        workItemId: variables.workItemId,
      };
    },
    onSuccess: (item, variables) => {
      queryClient.setQueryData(
        tenantWorkItemTargetQueryKey(tenantId, variables.workItemId),
        item,
      );
      void queryClient.invalidateQueries({ queryKey: dashboardPrefix });
      void queryClient.invalidateQueries({
        queryKey: tenantWorkItemTargetQueryKey(tenantId, variables.workItemId),
      });
      void queryClient.invalidateQueries({
        queryKey: tenantWorkItemTimelineQueryKey(
          tenantId,
          variables.workItemId,
        ),
      });
    },
  });
}
