import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { isRunWorking } from "@/features/teamhub/run-status";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "./room-route-params";
import { roomRunStatusesQueryOptions } from "./room-queries";
import { RuntimeActivityPath } from "./runtime-status/runtime-activity-path-view";
import { roomRuntimePresentationEventsQueryOptions } from "./runtime-status/runtime-presentation-events-query";
import { chooseRoomWorkRun } from "./room-work";

/**
 * A full page of the work happening in one Room. It keeps reading the run
 * while the agent has not replied, so the path grows as the work continues.
 */
export function RoomWorkPage() {
  const { client } = useTeamHubRuntime();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const runs = useQuery({
    ...roomRunStatusesQueryOptions(client, tenantId, roomId),
    refetchInterval: 2_000,
  });
  const run = useMemo(
    () => chooseRoomWorkRun(runs.data?.items ?? []),
    [runs.data],
  );
  const working = run ? isRunWorking(run) : false;
  const events = useQuery({
    ...roomRuntimePresentationEventsQueryOptions(
      client,
      tenantId,
      roomId,
      run?.id ?? "",
    ),
    enabled: Boolean(run),
    refetchInterval: working ? 2_000 : false,
    staleTime: 0,
  });
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-app-surface">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 px-5 py-6">
        {runs.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading this room.
          </p>
        ) : runs.isError ? (
          <p className="text-sm text-destructive" role="alert">
            This room could not be read.
          </p>
        ) : !run ? (
          <p className="text-sm text-muted-foreground" role="status">
            Nothing is happening in this room.
          </p>
        ) : (
          <>
            <header>
              <h1 className="text-xl text-foreground">
                {working
                  ? `${run.agent.display_name} is working`
                  : `${run.agent.display_name} finished this run`}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {working
                  ? "This page keeps up while the agent is still working."
                  : "The agent has replied. The path below is what it did."}
              </p>
            </header>
            {events.isError ? (
              <p className="text-sm text-destructive" role="alert">
                The work could not be loaded.
              </p>
            ) : events.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading the work.
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <RuntimeActivityPath
                  lifecycle={working ? "active" : "ended"}
                  records={events.data?.items ?? []}
                />
              </div>
            )}
          </>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={chat}
        >
          Back to chat
        </Link>
      </div>
    </main>
  );
}
