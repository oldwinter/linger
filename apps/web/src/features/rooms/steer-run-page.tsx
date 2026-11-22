import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
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
  const headingId = useId();
  const runs = useQuery({
    ...roomRunStatusesQueryOptions(client, tenantId, roomId),
    refetchInterval: 2_000,
  });
  const workingRuns = useMemo(
    () => (runs.data?.items ?? []).filter(isRunWorking),
    [runs.data],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const run = useMemo(
    () =>
      (selectedRunId
        ? workingRuns.find((candidate) => candidate.id === selectedRunId)
        : undefined) ?? workingRuns[0],
    [selectedRunId, workingRuns],
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
  const requestIdsRef = useRef<Map<string, string>>(new Map());
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [errorByRunId, setErrorByRunId] = useState<
    Readonly<Record<string, string>>
  >({});
  const [stoppedByRunId, setStoppedByRunId] = useState<
    Readonly<Record<string, string>>
  >({});
  const pending = Boolean(run && pendingRunId === run.id);
  const error = run ? (errorByRunId[run.id] ?? null) : null;
  const stopped = run ? (stoppedByRunId[run.id] ?? null) : null;
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  const stop = async () => {
    if (!run || pending || stopped) return;
    const targetRun = run;
    let requestId = requestIdsRef.current.get(targetRun.id);
    if (!requestId) {
      requestId = createTeamHubIdempotencyKey();
      requestIdsRef.current.set(targetRun.id, requestId);
    }
    setPendingRunId(targetRun.id);
    setErrorByRunId((current) => {
      if (!(targetRun.id in current)) return current;
      const next = { ...current };
      delete next[targetRun.id];
      return next;
    });
    try {
      const result = await teamHubData(
        client.api.POST("/v0/rooms/{roomId}/runs/{runId}/cancel", {
          params: { path: { roomId, runId: targetRun.run_id } },
          body: { request_id: requestId },
        }),
      );
      setStoppedByRunId((current) => ({
        ...current,
        [targetRun.id]: stopResultCopy(result.status),
      }));
    } catch (cause) {
      setErrorByRunId((current) => ({
        ...current,
        [targetRun.id]:
          cause instanceof Error
            ? cause.message
            : "The run could not be stopped.",
      }));
    } finally {
      setPendingRunId((current) => (current === targetRun.id ? null : current));
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={chat}
          >
            <Icon icon={ArrowLeft01Icon} size={14} />
            Back to room
          </Link>
        </div>
        <header>
          <h2 className="text-xl text-foreground" id={headingId}>
            Steer this run
          </h2>
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
            {workingRuns.length > 1 ? (
              <div
                aria-label="Active runs"
                className="flex flex-wrap items-center gap-2"
                role="group"
              >
                {workingRuns.map((candidate, index) => {
                  const selected = candidate.id === run.id;
                  const duplicateName = workingRuns.some(
                    (other) =>
                      other.id !== candidate.id &&
                      other.agent.display_name === candidate.agent.display_name,
                  );
                  const label = duplicateName
                    ? `${candidate.agent.display_name} (${index + 1})`
                    : candidate.agent.display_name;
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "select-pill",
                        selected
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      key={candidate.id}
                      onClick={() => setSelectedRunId(candidate.id)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <h3 className="text-lg text-foreground">
              {`${run.agent.display_name} is working`}
            </h3>
            {events.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading the plan.
              </p>
            ) : events.isError ? (
              <div
                className="flex items-center justify-between gap-3"
                role="alert"
              >
                <p className="text-sm text-destructive">
                  The plan could not be loaded.
                </p>
                <Button
                  onClick={() => void events.refetch()}
                  size="compact"
                  tone="secondary"
                  type="button"
                >
                  Retry
                </Button>
              </div>
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
      </div>
    </section>
  );
}
