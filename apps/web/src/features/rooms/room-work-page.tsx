import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { isRunWorking } from "@/features/teamhub/run-status";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";
import { roomActionsMessages as m } from "./room-actions.messages";
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
  const t = useT();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const headingId = useId();
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
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-app-surface"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 px-5 py-6">
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={chat}
          >
            <Icon icon={ArrowLeft01Icon} size={14} />
            {t(m.backToRoom)}
          </Link>
        </div>
        {runs.isPending ? (
          <>
            <h2 className="text-xl text-foreground" id={headingId}>
              {t(m.roomWorkTitle)}
            </h2>
            <p className="text-sm text-muted-foreground" role="status">
              {t(m.roomWorkLoadingRoom)}
            </p>
          </>
        ) : runs.isError ? (
          <>
            <h2 className="text-xl text-foreground" id={headingId}>
              {t(m.roomWorkTitle)}
            </h2>
            <div
              className="flex items-center justify-between gap-3"
              role="alert"
            >
              <p className="text-sm text-destructive">
                {t(m.roomWorkLoadFailed)}
              </p>
              <Button
                onClick={() => void runs.refetch()}
                size="compact"
                tone="secondary"
                type="button"
              >
                {t(commonMessages.retry)}
              </Button>
            </div>
          </>
        ) : !run ? (
          <>
            <h2 className="text-xl text-foreground" id={headingId}>
              {t(m.roomWorkTitle)}
            </h2>
            <p className="text-sm text-muted-foreground" role="status">
              {t(m.roomWorkIdle)}
            </p>
          </>
        ) : (
          <>
            <header>
              <h2 className="text-xl text-foreground" id={headingId}>
                {working
                  ? t(m.roomWorkAgentWorking, { name: run.agent.display_name })
                  : t(m.roomWorkAgentFinished, {
                      name: run.agent.display_name,
                    })}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  working
                    ? m.roomWorkWorkingSubtitle
                    : m.roomWorkFinishedSubtitle,
                )}
              </p>
            </header>
            {events.isError ? (
              <div
                className="flex items-center justify-between gap-3"
                role="alert"
              >
                <p className="text-sm text-destructive">
                  {t(m.roomWorkEventsLoadFailed)}
                </p>
                <Button
                  onClick={() => void events.refetch()}
                  size="compact"
                  tone="secondary"
                  type="button"
                >
                  {t(commonMessages.retry)}
                </Button>
              </div>
            ) : events.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t(m.roomWorkLoadingWork)}
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
      </div>
    </section>
  );
}
