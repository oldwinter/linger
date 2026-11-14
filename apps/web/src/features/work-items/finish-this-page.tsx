import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { dashboardWorkItemPath } from "./work-item-routes";
import {
  tenantWorkItemTargetQueryKey,
  tenantWorkItemTargetQueryOptions,
  tenantWorkItemsDashboardQueryKey,
} from "./work-item-queries";

export function FinishThisPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const workItemId = requireRoomRouteParam(useParams().workItemId, "Work Item");
  const workItem = useQuery(
    tenantWorkItemTargetQueryOptions(client, tenantId, workItemId),
  );
  const finish = useMutation({
    mutationFn: (item: TeamHubWorkItem) => {
      const done = item.state !== "resolved";
      return teamHubData(
        client.api.POST("/v0/work-items/{workItemId}/transitions", {
          params: {
            path: { workItemId },
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
          },
          body: done
            ? {
                expected_version: item.version,
                resolution: "completed",
                state: "resolved",
              }
            : {
                expected_version: item.version,
                state: "open",
              },
        }),
      );
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(
        tenantWorkItemTargetQueryKey(tenantId, workItemId),
        updated,
      );
      await queryClient.invalidateQueries({
        queryKey: tenantWorkItemsDashboardQueryKey(tenantId),
      });
    },
  });

  if (workItem.isPending) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="status">Loading this job...</p>
      </main>
    );
  }

  if (workItem.isError || !workItem.data) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="alert">This job could not be opened.</p>
      </main>
    );
  }

  const item = finish.data ?? workItem.data;
  const carriedOut = Boolean(item.task_execution);
  const finished = item.state === "resolved" && item.resolution === "completed";

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{item.title}</p>
      <h1 className="mt-1 text-2xl text-foreground">Finish this</h1>
      {carriedOut ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This job is being carried out. The dashboard leaves it to that run.
        </p>
      ) : finished ? (
        <>
          <p
            className="mt-3 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            It's done. It sits in Done.
          </p>
          <Button
            className="mt-6"
            disabled={finish.isPending}
            onClick={() => finish.mutate(item)}
            type="button"
          >
            Open it again
          </Button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Mark it done and it leaves the open work.
          </p>
          <Button
            className="mt-6"
            disabled={finish.isPending}
            onClick={() => finish.mutate(item)}
            tone="primary"
            type="button"
          >
            Mark it done
          </Button>
        </>
      )}
      {finish.isError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          That change did not stay.
        </p>
      ) : null}
      <Link
        className="mt-8 inline-block text-sm text-muted-foreground underline"
        to={dashboardWorkItemPath(tenantId, workItemId)}
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
