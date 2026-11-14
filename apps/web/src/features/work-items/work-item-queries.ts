import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { collectTeamHubCursorPages } from "@/features/teamhub/teamhub-cursor-pages";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { teamHubData, idempotencyHeader } from "@/features/teamhub/teamhub-api";
import {
  createTeamHubIdempotencyKey,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  workItemDashboardListFilterSearch,
  workItemDashboardListQuery,
  type WorkItemDashboardFilters,
} from "./work-item-dashboard-filters";

export function tenantWorkItemTargetQueryKey(
  tenantId: string,
  workItemId: string,
) {
  return ["teamhub", tenantId, "work-items", "target", workItemId] as const;
}

export function tenantWorkItemTargetQueryPrefix(tenantId: string) {
  return ["teamhub", tenantId, "work-items", "target"] as const;
}

export function tenantWorkItemTargetQueryOptions(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  workItemId: string,
) {
  return queryOptions({
    queryFn: async () => {
      const item = await teamHubData(
        client.api.GET("/v0/work-items/{workItemId}", {
          params: { path: { workItemId } },
        }),
      );
      if (item.id !== workItemId || item.tenant_id !== tenantId) {
        throw new TeamHubError({
          code: "WORK_ITEM_NOT_FOUND",
          message: "Work Item is unavailable in this Tenant.",
          status: 404,
        });
      }
      return item;
    },
    queryKey: tenantWorkItemTargetQueryKey(tenantId, workItemId),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function tenantWorkItemCommentsQueryKey(
  tenantId: string,
  workItemId: string,
) {
  return ["teamhub", tenantId, "work-items", "comments", workItemId] as const;
}

export function tenantWorkItemCommentsQueryOptions(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  workItemId: string,
) {
  return queryOptions({
    queryFn: async () => {
      const page = await collectTeamHubCursorPages((pagination) =>
        teamHubData(
          client.api.GET("/v0/work-items/{workItemId}/comments", {
            params: { path: { workItemId }, query: pagination },
          }),
        ),
      );
      if (
        page.items.some(
          (comment) =>
            comment.tenant_id !== tenantId ||
            comment.work_item_id !== workItemId,
        )
      ) {
        throw new Error("Work Item Comments do not match the requested Item.");
      }
      return page.items;
    },
    queryKey: tenantWorkItemCommentsQueryKey(tenantId, workItemId),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function tenantWorkItemTimelineQueryKey(
  tenantId: string,
  workItemId: string,
) {
  return ["teamhub", tenantId, "work-items", "timeline", workItemId] as const;
}

export function tenantWorkItemTimelineQueryOptions(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  workItemId: string,
) {
  return queryOptions({
    queryFn: async () => {
      const page = await collectTeamHubCursorPages((pagination) =>
        teamHubData(
          client.api.GET("/v0/work-items/{workItemId}/timeline", {
            params: { path: { workItemId }, query: pagination },
          }),
        ),
      );
      return page.items;
    },
    queryKey: tenantWorkItemTimelineQueryKey(tenantId, workItemId),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

interface WorkItemTransitionInput {
  expectedVersion: number;
  resolution?: NonNullable<TeamHubWorkItem["resolution"]>;
  state: TeamHubWorkItem["state"];
}

/**
 * A transition changes both the board and the open peek, so the answer replaces
 * the target cache and both lists refetch. The timeline gains its state entry.
 */
export function useWorkItemTransition(tenantId: string, workItemId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkItemTransitionInput) =>
      teamHubData(
        client.api.POST("/v0/work-items/{workItemId}/transitions", {
          body: {
            expected_version: input.expectedVersion,
            resolution: input.resolution,
            state: input.state,
          },
          params: {
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
            path: { workItemId },
          },
        }),
      ),
    onSuccess: (item) => {
      queryClient.setQueryData(
        tenantWorkItemTargetQueryKey(tenantId, workItemId),
        item,
      );
      void queryClient.invalidateQueries({
        queryKey: tenantWorkItemsDashboardQueryPrefix(tenantId),
      });
      void queryClient.invalidateQueries({
        queryKey: tenantWorkItemTargetQueryKey(tenantId, workItemId),
      });
      void queryClient.invalidateQueries({
        queryKey: tenantWorkItemTimelineQueryKey(tenantId, workItemId),
      });
    },
  });
}

export function tenantWorkItemsDashboardQueryPrefix(tenantId: string) {
  return ["teamhub", tenantId, "work-items", "dashboard"] as const;
}

export function tenantWorkItemsDashboardQueryKey(
  tenantId: string,
  filters: WorkItemDashboardFilters,
) {
  return [
    ...tenantWorkItemsDashboardQueryPrefix(tenantId),
    workItemDashboardListFilterSearch(filters),
  ] as const;
}

export function tenantAgentWorkItemsQueryKey(
  tenantId: string,
  agentActorId: string,
) {
  return ["teamhub", tenantId, "work-items", "agent", agentActorId] as const;
}

export function tenantAgentWorkItemsQueryOptions(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  agentActorId: string,
) {
  return queryOptions({
    queryFn: async () => {
      const page = await collectTeamHubCursorPages((pagination) =>
        teamHubData(
          client.api.GET("/v0/tenants/{tenantId}/work-items", {
            params: {
              path: { tenantId },
              query: { ...pagination, scope: "tenant" },
            },
          }),
        ),
      );
      if (page.items.some((item) => item.tenant_id !== tenantId)) {
        throw new Error(
          "Agent Work Item list does not match the active Tenant.",
        );
      }
      return {
        ...page,
        items: page.items.filter((item) =>
          item.assignees.some(
            (assignment) => assignment.actor.id === agentActorId,
          ),
        ),
      };
    },
    queryKey: tenantAgentWorkItemsQueryKey(tenantId, agentActorId),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function tenantWorkItemsDashboardQueryOptions(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  filters: WorkItemDashboardFilters,
  currentActorId?: string,
) {
  return queryOptions({
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const page = await collectTeamHubCursorPages((pagination) =>
        teamHubData(
          client.api.GET("/v0/tenants/{tenantId}/work-items", {
            params: {
              path: { tenantId },
              query: {
                ...pagination,
                ...workItemDashboardListQuery(filters, currentActorId),
                scope: "personal",
              },
            },
          }),
        ),
      );
      if (page.items.some((item) => item.tenant_id !== tenantId)) {
        throw new Error(
          "Work Item Dashboard does not match the active Tenant.",
        );
      }
      return page;
    },
    queryKey: tenantWorkItemsDashboardQueryKey(tenantId, filters),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
