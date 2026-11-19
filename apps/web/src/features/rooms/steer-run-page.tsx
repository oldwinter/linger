import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { isRunWorking } from "@/features/teamhub/run-status";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "./room-route-params";
import { roomRunStatusesQueryOptions } from "./room-queries";
import { roomRuntimePresentationEventsQueryOptions } from "./runtime-status/runtime-presentation-events-query";
import { latestPlan, planStepLabel, stopResultCopy } from "./steer-run";

/**
 * The plan of the run that is still working, and a stop before its next
 * step. The activity log stays on its own page.
 */
export function SteerRunPage() {
  const { client } = useTeamHubRuntime();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const runs = useQuery({
    ...roomRunStatusesQueryOptions(client, tenantId, roomId),
    refetchInterval: 2_000,
  });
  const run = useMemo(
    () => (runs.data?.items ?? []).find(isRunWorking),
    [runs.data],
  );
  const events = useQuery({
    ...roomRuntimePresentationEventsQueryOptions(
      client,
      tenantId,
      roomId,
      run?.id ?? "",
    ),
    enabled: Boolean(run),
    refetchInterval: run ? 2_000 : false,
    staleTime: 0,
  });
  const steps = useMemo(
    () => latestPlan(events.data?.items ?? []),
    [events.data],
  );
  const requestIdRef = useRef<{ key: string; runId: string } | null>(null);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{
    message: string;
    runId: string;
  } | null>(null);
  const [stoppedState, setStoppedState] = useState<{
    message: string;
    runId: string;
  } | null>(null);
  const pending = Boolean(run && pendingRunId === run.id);
  const error = run && errorState?.runId === run.id ? errorState.message : null;
  const stopped =
    run && stoppedState?.runId === run.id ? stoppedState.message : null;
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  const stop = async () => {
    if (!run || pending || stopped) return;
    const targetRun = run;
    if (requestIdRef.current?.runId !== targetRun.id) {
      requestIdRef.current = {
        key: createTeamHubIdempotencyKey(),
        runId: targetRun.id,
      };
    }
    const requestId = requestIdRef.current.key;
    setPendingRunId(targetRun.id);
    setErrorState(null);
    try {
      const result = await teamHubData(
        client.api.POST("/v0/rooms/{roomId}/runs/{runId}/cancel", {
          params: { path: { roomId, runId: targetRun.run_id } },
          body: { request_id: requestId },
        }),
      );
      setStoppedState({
        message: stopResultCopy(result.status),
        runId: targetRun.id,
      });
    } catch (cause) {
      setErrorState({
        message:
          cause instanceof Error
            ? cause.message
            : "The run could not be stopped.",
        runId: targetRun.id,
      });
    } finally {
      setPendingRunId((current) => (current === targetRun.id ? null : current));
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">Steer this run</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The plan the agent published while it is still working. Stop it
            before the next step.
          </p>
        </header>
        {runs.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading this run.
          </p>
        ) : runs.isError ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-destructive">
              Run status could not be loaded.
            </p>
            <Button
              onClick={() => void runs.refetch()}
              size="compact"
              tone="secondary"
              type="button"
            >
              Retry
            </Button>
          </div>
        ) : !run ? (
          <p className="text-sm text-muted-foreground" role="status">
            Nothing is running in this room.
          </p>
        ) : (
          <>
            <h2 className="text-lg text-foreground">
              {`${run.agent.display_name} is working`}
            </h2>
            {events.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading the plan.
              </p>
            ) : events.isError ? (
              <p className="text-sm text-destructive" role="alert">
                The plan could not be loaded.
              </p>
            ) : steps.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                The agent has not published a plan yet.
              </p>
            ) : (
              <ol aria-label="Run plan" className="flex flex-col gap-3">
                {steps.map((step, index) => (
                  <li
                    className="rounded-2xl border border-border px-4 py-3"
                    key={`${index}-${step.content}`}
                  >
                    <p className="text-xs text-muted-foreground">
                      {planStepLabel(step.status)}
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {step.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {stopped ? (
              <p className="text-sm text-foreground" role="status">
                {stopped}
              </p>
            ) : (
              <Button
                disabled={pending}
                onClick={() => void stop()}
                type="button"
              >
                {pending ? "Stopping" : "Stop before the next step"}
              </Button>
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
