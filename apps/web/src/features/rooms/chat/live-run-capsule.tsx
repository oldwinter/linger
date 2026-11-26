import {
  Activity01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  SentIcon,
  StopCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import {
  createTeamHubIdempotencyKey,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type {
  TeamHubRunStatus,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { ActorAvatar } from "../members/actor-avatar";
import { projectRuntimeChatPresentation } from "../runtime-status/runtime-presentation-events";
import { roomRuntimePresentationEventsQueryOptions } from "../runtime-status/runtime-presentation-events-query";
import { latestPlan, type SteerPlanStep } from "../steer-run";
import { steerRunMessages } from "../steer-run.messages";
import type { MessageComposition } from "./message-composer";
import { liveRunCapsuleMessages as m } from "./live-run-capsule.messages";

export interface LiveRunCapsuleProps {
  client: TeamHubClient;
  onOpenActivity: (run: TeamHubRunStatus) => void;
  onSendSteer: (composition: MessageComposition) => Promise<void> | void;
  roomId: string;
  roomKind?: "direct" | "room" | "thread";
  runtimePresentationEventsByRunStatusId?: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >;
  tenantId: string;
  workingRuns: readonly TeamHubRunStatus[];
}

const EMPTY_EVENTS: readonly TeamHubRuntimePresentationEventRecord[] = [];

/**
 * Compact docked capsule above the composer while at least one Agent run is
 * actively working. Expands in-place to show the live plan checklist, send a
 * steering follow-up, open the Activity panel, or stop the run.
 */
export function LiveRunCapsule({
  client,
  onOpenActivity,
  onSendSteer,
  roomId,
  roomKind = "room",
  runtimePresentationEventsByRunStatusId,
  tenantId,
  workingRuns,
}: LiveRunCapsuleProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [steerDraft, setSteerDraft] = useState("");
  const [steerPending, setSteerPending] = useState(false);
  const [steerSentFor, setSteerSentFor] = useState<string | null>(null);
  const [steerError, setSteerError] = useState<string | null>(null);

  const requestIdsRef = useRef<Map<string, string>>(new Map());
  const [pendingStopRunId, setPendingStopRunId] = useState<string | null>(null);
  const [stopErrorByRunId, setStopErrorByRunId] = useState<
    Readonly<Record<string, string>>
  >({});
  const [stoppedByRunId, setStoppedByRunId] = useState<
    Readonly<Record<string, string>>
  >({});

  useEffect(() => {
    if (workingRuns.length === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [workingRuns.length]);

  useEffect(() => {
    if (!steerSentFor) return;
    const timer = window.setTimeout(() => setSteerSentFor(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [steerSentFor]);

  const selectedRun = useMemo(
    () =>
      (selectedRunId
        ? workingRuns.find((candidate) => candidate.id === selectedRunId)
        : undefined) ?? workingRuns[0],
    [selectedRunId, workingRuns],
  );

  const streamedEvents = selectedRun
    ? (runtimePresentationEventsByRunStatusId?.[selectedRun.id] ?? EMPTY_EVENTS)
    : EMPTY_EVENTS;

  const queriedEvents = useQuery({
    ...roomRuntimePresentationEventsQueryOptions(
      client,
      tenantId,
      roomId,
      selectedRun?.id ?? "",
    ),
    enabled:
      Boolean(selectedRun) &&
      typeof client.api?.GET === "function" &&
      (streamedEvents.length === 0 || expanded),
    refetchInterval: expanded && selectedRun ? 2_000 : false,
    staleTime: 2_000,
  });

  const eventRecords = useMemo(() => {
    const queried = queriedEvents.data?.items ?? EMPTY_EVENTS;
    return queried.length >= streamedEvents.length ? queried : streamedEvents;
  }, [queriedEvents.data?.items, streamedEvents]);

  const steps = useMemo(() => latestPlan(eventRecords), [eventRecords]);
  const presentation = useMemo(
    () =>
      eventRecords.length > 0
        ? projectRuntimeChatPresentation(eventRecords)
        : undefined,
    [eventRecords],
  );

  if (!selectedRun) return null;

  const completedSteps = steps.filter(
    (step) => step.status === "completed",
  ).length;
  const currentStep =
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending");
  const activeToolTitle = resolveActiveToolTitle(presentation);
  const summaryText =
    currentStep?.content ?? activeToolTitle ?? t(m.workingFallback);
  const elapsedLabel = formatElapsedDuration(selectedRun.created_at, nowMs);

  const stopPending = pendingStopRunId === selectedRun.id;
  const stopError = stopErrorByRunId[selectedRun.id] ?? null;
  const stoppedCopy = stoppedByRunId[selectedRun.id] ?? null;

  async function handleStop() {
    if (!selectedRun || stopPending || stoppedCopy) return;
    const targetRun = selectedRun;
    let requestId = requestIdsRef.current.get(targetRun.id);
    if (!requestId) {
      requestId = createTeamHubIdempotencyKey();
      requestIdsRef.current.set(targetRun.id, requestId);
    }
    setPendingStopRunId(targetRun.id);
    setStopErrorByRunId((current) => {
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
        [targetRun.id]:
          result.status === "already_terminal"
            ? t(steerRunMessages.alreadyFinished)
            : t(steerRunMessages.stopRequested),
      }));
    } catch (cause) {
      setStopErrorByRunId((current) => ({
        ...current,
        [targetRun.id]:
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : t(m.stopFailed),
      }));
    } finally {
      setPendingStopRunId((current) =>
        current === targetRun.id ? null : current,
      );
    }
  }

  async function handleSteerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRun || steerPending) return;
    const trimmed = steerDraft.trim();
    if (!trimmed) return;
    setSteerPending(true);
    setSteerError(null);
    setSteerSentFor(null);
    const agent = selectedRun.agent;
    const mentionPrefix = `@${agent.display_name}`;
    const needsMention =
      roomKind === "room" &&
      !trimmed.toLowerCase().includes(mentionPrefix.toLowerCase());
    const body = needsMention ? `${mentionPrefix} ${trimmed}` : trimmed;
    const mentions =
      roomKind === "room"
        ? [
            {
              display_name: agent.display_name,
              id: agent.id,
              kind: "agent" as const,
              tenant_id: tenantId,
            },
          ]
        : [];
    try {
      await onSendSteer({
        body,
        files: [],
        mentions,
      });
      setSteerDraft("");
      setSteerSentFor(agent.display_name);
    } catch (cause) {
      setSteerError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : t(m.steerFailed),
      );
    } finally {
      setSteerPending(false);
    }
  }

  return (
    <section
      aria-label={t(m.regionLabel)}
      className="room-readable relative z-10 pb-1.5"
      data-testid="live-run-capsule"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <button
          aria-expanded={expanded}
          aria-label={t(expanded ? m.collapseDetails : m.expandDetails)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span className="relative flex shrink-0 items-center">
            <ActorAvatar
              actorId={selectedRun.agent.id}
              animate
              kind="agent"
              name={selectedRun.agent.display_name}
              showTitle={false}
              size="xxs"
            />
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-app-info ring-2 ring-card motion-safe:animate-pulse"
            />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-foreground">
              {t(m.agentWorking, { name: selectedRun.agent.display_name })}
            </span>
            {workingRuns.length > 1 ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs leading-none font-medium text-muted-foreground">
                {t(m.moreWorking, { count: workingRuns.length - 1 })}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className="shrink-0 text-2xs text-app-subtle"
            >
              ·
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-app-muted">
              {summaryText}
            </span>
          </span>
          {steps.length > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs leading-none font-medium text-muted-foreground tabular-nums">
              {t(m.stepProgress, {
                completed: completedSteps,
                total: steps.length,
              })}
            </span>
          ) : null}
          <span className="shrink-0 text-2xs text-app-subtle tabular-nums">
            {elapsedLabel}
          </span>
          <Icon
            className={cn(
              "shrink-0 text-app-muted transition-transform duration-150",
              expanded && "rotate-180",
            )}
            icon={ArrowDown01Icon}
            size={14}
          />
        </button>

        {expanded ? (
          <div className="space-y-2.5 border-t border-border/80 bg-app-surface-soft/50 px-3 py-2.5">
            {workingRuns.length > 1 ? (
              <div
                aria-label={t(m.activeRuns)}
                className="flex flex-wrap items-center gap-1.5"
                role="group"
              >
                {workingRuns.map((candidate, index) => {
                  const isSelected = candidate.id === selectedRun.id;
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
                      aria-pressed={isSelected}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground shadow-outline hover:text-foreground",
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

            {steps.length > 0 ? (
              <ol
                aria-label={t(steerRunMessages.runPlan)}
                className="max-h-40 space-y-1 overflow-y-auto pr-0.5"
              >
                {steps.map((step, index) => (
                  <li
                    className={cn(
                      "flex items-start gap-2 rounded-lg px-2 py-1 text-xs",
                      step.status === "in_progress"
                        ? "bg-card text-foreground shadow-outline"
                        : "text-muted-foreground",
                    )}
                    key={`${index}-${step.content}`}
                  >
                    <StepStatusGlyph status={step.status} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 leading-4",
                        step.status === "completed" &&
                          "line-through opacity-75",
                        step.status === "canceled" && "line-through opacity-60",
                      )}
                    >
                      {step.content}
                    </span>
                    <span className="shrink-0 text-2xs text-app-subtle">
                      {t(stepStatusMessage(step.status))}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-app-muted" role="status">
                {activeToolTitle ?? t(m.noPlanYet)}
              </p>
            )}

            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => void handleSteerSubmit(event)}
            >
              <input
                aria-label={t(m.steerLabel, {
                  name: selectedRun.agent.display_name,
                })}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-app-placeholder focus-visible:border-app-field-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={steerPending}
                onChange={(event) => {
                  setSteerDraft(event.target.value);
                  if (steerSentFor) setSteerSentFor(null);
                  if (steerError) setSteerError(null);
                }}
                placeholder={t(m.steerPlaceholder, {
                  name: selectedRun.agent.display_name,
                })}
                type="text"
                value={steerDraft}
              />
              <Button
                data-voice-risk="never"
                disabled={steerPending || steerDraft.trim().length === 0}
                size="compact"
                tone="secondary"
                type="submit"
              >
                <Icon icon={SentIcon} size={14} />
                <span>{t(steerPending ? m.steerSending : m.steerAction)}</span>
              </Button>
            </form>

            {steerSentFor ? (
              <p className="text-xs text-app-muted" role="status">
                {t(m.steerSent, { name: steerSentFor })}
              </p>
            ) : null}
            {steerError ? (
              <p className="text-xs text-app-danger" role="alert">
                {steerError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <Button
                onClick={() => onOpenActivity(selectedRun)}
                size="compact"
                tone="ghost"
                type="button"
              >
                <Icon icon={Activity01Icon} size={14} />
                <span>{t(m.openActivity)}</span>
              </Button>
              <div className="flex items-center gap-2">
                {stopError ? (
                  <span className="text-xs text-app-danger" role="alert">
                    {stopError}
                  </span>
                ) : null}
                {stoppedCopy ? (
                  <span className="text-xs text-foreground" role="status">
                    {stoppedCopy}
                  </span>
                ) : (
                  <Button
                    aria-label={t(m.stopRunAria, {
                      name: selectedRun.agent.display_name,
                    })}
                    data-voice-risk="confirm"
                    disabled={stopPending}
                    onClick={() => void handleStop()}
                    size="compact"
                    tone="secondary"
                    type="button"
                  >
                    <Icon icon={StopCircleIcon} size={14} />
                    <span>{t(stopPending ? m.stoppingRun : m.stopRun)}</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepStatusGlyph({ status }: { status: SteerPlanStep["status"] }) {
  if (status === "completed") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-app-status-success-text"
      >
        <Icon icon={Tick02Icon} size={12} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        aria-hidden="true"
        className="mt-1 size-2 shrink-0 rounded-full bg-app-info motion-safe:animate-pulse"
      />
    );
  }
  if (status === "canceled") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-app-subtle"
      >
        <Icon icon={Cancel01Icon} size={12} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-1 size-2 shrink-0 rounded-full border border-border-hover"
    />
  );
}

function stepStatusMessage(status: SteerPlanStep["status"]) {
  if (status === "completed") return steerRunMessages.stepCompleted;
  if (status === "in_progress") return steerRunMessages.stepInProgress;
  if (status === "canceled") return steerRunMessages.stepCanceled;
  return steerRunMessages.stepPending;
}

function resolveActiveToolTitle(
  presentation: ReturnType<typeof projectRuntimeChatPresentation> | undefined,
): string | undefined {
  if (!presentation) return undefined;
  for (let index = presentation.items.length - 1; index >= 0; index -= 1) {
    const item = presentation.items[index];
    if (item?.type !== "status") continue;
    const activeActivity = item.activities
      ?.slice()
      .reverse()
      .find((activity) => activity.outcome === undefined);
    if (activeActivity?.title) return activeActivity.title;
    if (item.title) return item.title;
  }
  return presentation.currentTitle;
}

export function formatElapsedDuration(createdAt: string, nowMs: number) {
  const startedAt = Date.parse(createdAt);
  if (Number.isNaN(startedAt)) return "0s";
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAt) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
