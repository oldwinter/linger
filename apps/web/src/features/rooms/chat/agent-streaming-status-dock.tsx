import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useRoomRenderTiming } from "../room-render-timing";
import { cn } from "@/lib/cn";
import { translate, type Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";
import { isRunWorking } from "@/features/teamhub/run-status";
import type {
  TeamHubRoomRunCancelResult,
  TeamHubRoomRunRedeliverResult,
  TeamHubRunStatus,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";
import {
  projectRuntimeChatPresentation,
  type RuntimeActivityPresentation,
  type RuntimeChatPresentation,
  type RuntimeExecutionFailure,
  type RuntimeOutputPresentation,
  type RuntimePlanPresentation,
  type RuntimeStatusMark,
} from "@/features/rooms/runtime-status/runtime-presentation-events";
import {
  activityStatusLine,
  toolInputFromEntries,
  toolPresentation,
} from "../runtime-status/runtime-tool-presentation";
import { runtimeStatusMessages as m } from "../runtime-status/runtime-status.messages";
import {
  isRunInterruption,
  runtimeFailureMessage,
  runtimeFailureReason,
} from "../runtime-status/runtime-failure-message";
import type { AgentAvatarStatus } from "../members/agent-avatar-status-context";
import { ActorAvatar } from "../members/actor-avatar";
import { AgentRunResendButton, AgentRunStopButton } from "./room-run-controls";
import {
  useAgentStatusLine,
  type AgentStatusLineContent,
  type AgentStatusLineItem,
  type AgentStatusLineShown,
} from "./agent-status-line";

const EMPTY_RUN_STATUSES: TeamHubRunStatus[] = [];
const EMPTY_RUNTIME_EVENTS: Readonly<
  Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
> = {};

/**
 * Each Run's last view, kept while the Run stays listed. A Run is projected
 * again only when its status or its event list is a new object, so one Run's
 * runtime event does not re-project every other Run. A view holds the words
 * of the language it was projected in, so a language switch projects again.
 */
export type RuntimeTimelineViewCache = Map<
  string,
  {
    records: readonly TeamHubRuntimePresentationEventRecord[] | undefined;
    runStatus: TeamHubRunStatus;
    t: Translate;
    view: AgentRunStatusView | undefined;
  }
>;

export function buildRuntimeTimelineViews({
  cache,
  runStatuses,
  runtimePresentationEventsByRunStatusId,
  t,
}: {
  /** Reused and pruned to the given Runs on every pass. */
  cache?: RuntimeTimelineViewCache;
  runStatuses: readonly TeamHubRunStatus[];
  runtimePresentationEventsByRunStatusId: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >;
  t: Translate;
}) {
  const runtimeStatusViews: AgentRunStatusView[] = [];
  const listed = new Set<string>();
  for (const runStatus of runStatuses) {
    const records = runtimePresentationEventsByRunStatusId[runStatus.id];
    const cached = cache?.get(runStatus.id);
    const view =
      cached?.runStatus === runStatus &&
      cached.records === records &&
      cached.t === t
        ? cached.view
        : runtimeTimelineView(runStatus, records, t);
    listed.add(runStatus.id);
    cache?.set(runStatus.id, { records, runStatus, t, view });
    if (view) runtimeStatusViews.push(view);
  }
  for (const runStatusId of cache?.keys() ?? []) {
    if (!listed.has(runStatusId)) cache?.delete(runStatusId);
  }
  return runtimeStatusViews;
}

function runtimeTimelineView(
  runStatus: TeamHubRunStatus,
  records: readonly TeamHubRuntimePresentationEventRecord[] | undefined,
  t: Translate,
) {
  const presentation = records
    ? projectRuntimeChatPresentation(records)
    : undefined;
  const history = resolveAgentRunStatusHistory({ runStatus, presentation, t });
  if (history.length === 0) return undefined;
  return createAgentRunStatusView(runStatus, history, history.at(-1)!.key);
}

function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`town-dots shrink-0 ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
}

// Compared in code; `stateLabels` holds the words shown for each.
type AgentRuntimeState =
  | "Canceled"
  | "Completed"
  | "Failed"
  | "Needs attention"
  | "Recovering"
  | "Responding"
  | "Stopped"
  | "Thinking"
  | "Waiting for background task"
  | "Waiting for your input"
  | "Working";

const stateLabels: Record<AgentRuntimeState, Message<string>> = {
  Canceled: m.stateCanceled,
  Completed: m.stateCompleted,
  Failed: m.stateFailed,
  "Needs attention": m.stateNeedsAttention,
  Recovering: m.stateRecovering,
  // An Agent writing its reply reads as typing, like a person.
  Responding: m.stateTyping,
  Stopped: m.stateStopped,
  Thinking: m.stateThinking,
  "Waiting for background task": m.stateWaitingBackground,
  "Waiting for your input": m.stateWaitingForInput,
  Working: m.stateWorking,
};

interface AgentRuntimeStatusSegment {
  activities: readonly RuntimeActivityPresentation[];
  key: string;
  /** What the Dock's status line shows for this Agent. */
  line: AgentStatusLineContent;
  /** The entries of the line's current group, ending with `line`. */
  lineQueue?: readonly AgentStatusLineItem[];
  outputs: readonly RuntimeOutputPresentation[];
  plan?: RuntimePlanPresentation;
  state: AgentRuntimeState;
  /** The Run ended with follow-ups whose delivery is unconfirmed. */
  unconfirmedFollowUps?: true;
}

type AgentRunStatusView = AgentRuntimeStatusSegment & {
  runStatus: TeamHubRunStatus;
  highlightedSegmentKey: string;
  history: readonly AgentRuntimeStatusSegment[];
};

export function isLiveAgentRunStatus(runtimeStatus: AgentRunStatusView) {
  return (
    isRunWorking(runtimeStatus.runStatus) &&
    runtimeStatus.state !== "Canceled" &&
    runtimeStatus.state !== "Completed" &&
    runtimeStatus.state !== "Failed" &&
    runtimeStatus.state !== "Stopped" &&
    runtimeStatus.state !== "Needs attention"
  );
}

function resolveAgentRunStatusHistory({
  runStatus,
  presentation,
  t,
}: {
  runStatus: Pick<TeamHubRunStatus, "status">;
  presentation?: RuntimeChatPresentation;
  t: Translate;
}): readonly AgentRuntimeStatusSegment[] {
  if (presentation) {
    const history = presentation.items
      .filter((item) => item.type === "status")
      .map((item, index) =>
        resolveAgentRuntimeStatusSegment({
          activities: item.activities,
          first: index === 0,
          key: item.key,
          marks: item.marks,
          outputs: item.outputs,
          plan: item.plan,
          status: item.status,
          t,
          terminalOutcome: item.terminalOutcome,
          failure: item.failure,
          title: item.title,
          unconfirmedInputIds: item.unconfirmedInputIds,
        }),
      );
    if (history.length > 0) return history;
    if (!presentation.currentStatus) {
      return runStatus.status === "active"
        ? [fallbackAgentRuntimeStatusSegment(t)]
        : runStatus.status === "aborted"
          ? [stoppedAgentRuntimeStatusSegment(t)]
          : [];
    }
    return [
      resolveAgentRuntimeStatusSegment({
        first: true,
        key: "snapshot",
        status: presentation.currentStatus,
        t,
        title: presentation.currentTitle,
      }),
    ];
  }

  return runStatus.status === "active"
    ? [fallbackAgentRuntimeStatusSegment(t)]
    : runStatus.status === "aborted"
      ? [stoppedAgentRuntimeStatusSegment(t)]
      : [];
}

function fallbackAgentRuntimeStatusSegment(
  t: Translate,
): AgentRuntimeStatusSegment {
  return resolveAgentRuntimeStatusSegment({
    first: true,
    key: "snapshot",
    status: "working",
    t,
  });
}

// An aborted Run status covers both failed and canceled Runs; until its
// presentation events arrive, the outcome and its cause are not known.
function stoppedAgentRuntimeStatusSegment(
  t: Translate,
): AgentRuntimeStatusSegment {
  return {
    activities: [],
    key: "stopped",
    line: { tone: "warn", text: t(m.runStopped) },
    outputs: [],
    state: "Stopped",
  };
}

function resolveAgentRuntimeStatusSegment({
  activities = [],
  first = false,
  key,
  marks = [],
  outputs = [],
  plan,
  status,
  t,
  terminalOutcome,
  title,
  unconfirmedInputIds,
  failure,
}: {
  activities?: readonly RuntimeActivityPresentation[];
  /** The Run's first Segment, before which the Agent has done nothing. */
  first?: boolean;
  key: string;
  /** Thinking and Activity starts in order, for the Dock's status line. */
  marks?: readonly RuntimeStatusMark[];
  outputs?: readonly RuntimeOutputPresentation[];
  plan?: RuntimePlanPresentation;
  status: "queued" | "working" | "thinking" | "waiting_background";
  t: Translate;
  terminalOutcome?: "canceled" | "completed" | "failed";
  failure?: RuntimeExecutionFailure;
  /** The thinking summary while the status is thinking. */
  title?: string;
  unconfirmedInputIds?: readonly string[];
}): AgentRuntimeStatusSegment {
  const activeActivities = activities
    .filter((activity) => activity.outcome === undefined)
    .reverse();
  // Replayed native activities may arrive after the recovery activity. They do
  // not establish that the cloud has caught up with the Computer yet.
  const activeActivity =
    activeActivities.find((activity) => activity.kind === "recovery") ??
    activeActivities[0];
  const unconfirmed = Boolean(terminalOutcome && unconfirmedInputIds?.length);
  const state: AgentRuntimeState =
    unconfirmed && terminalOutcome !== "failed"
      ? "Needs attention"
      : terminalOutcome === "completed"
        ? "Completed"
        : terminalOutcome === "canceled"
          ? "Canceled"
          : terminalOutcome === "failed"
            ? isRunInterruption(failure)
              ? "Stopped"
              : "Failed"
            : activeActivity?.kind === "recovery"
              ? "Recovering"
              : activeActivity?.kind === "interaction"
                ? "Waiting for your input"
                : status === "thinking"
                  ? "Thinking"
                  : status === "waiting_background"
                    ? "Waiting for background task"
                    : activeActivity?.kind === "response"
                      ? "Responding"
                      : "Working";
  // Like grok-bot's, the status line names what the Agent did last and plays
  // the entries of its current group in order (see statusLineQueue). Dots
  // wait for the Agent's first Activity or thinking, and Working follows a
  // message once it has gone out (an output closes its Segment).
  const queue = statusLineQueue(marks, activities, t);
  const lineRunning = activities
    .filter(
      (activity) =>
        activity.outcome === undefined && activity.kind !== "message",
    )
    .reverse();
  // Recovery and waiting for input name the Agent's state, not a step.
  const stateActivity =
    lineRunning.find((activity) => activity.kind === "recovery") ??
    lineRunning.find((activity) => activity.kind === "interaction");
  const failureReason =
    state === "Failed" ? runtimeFailureReason(t, failure) : undefined;
  // An interrupted Run says why it stopped, and that a follow-up may be lost.
  const stoppedText = unconfirmed
    ? t(m.stoppedFollowUpUnconfirmed, {
        reason: runtimeFailureMessage(t, failure),
      })
    : runtimeFailureMessage(t, failure);
  const line: AgentStatusLineContent =
    state === "Failed"
      ? {
          tone: "danger",
          text: failureReason
            ? t(m.runFailedWith, { reason: failureReason })
            : t(m.runFailed),
        }
      : state === "Stopped"
        ? { tone: "warn", text: stoppedText }
        : state === "Needs attention"
          ? { tone: "warn", text: t(m.followUpUnconfirmed) }
          : stateActivity
            ? {
                tone: "live",
                text: activityStatusLine(t, stateActivity.kind).steps[0]!,
                runningActivityId: stateActivity.activityId,
              }
            : status === "queued"
              ? { tone: "wait" }
              : status === "waiting_background"
                ? {
                    tone: "live",
                    text: t(m.stateWaitingBackground),
                  }
                : outputs.length > 0 && lineRunning.length === 0
                  ? { tone: "live", text: t(m.stateWorking) }
                  : queue.length > 0
                    ? queue.at(-1)!.content
                    : status === "thinking"
                      ? {
                          tone: "live",
                          text: title?.trim() || t(m.stateThinking),
                        }
                      : first && activities.length === 0
                        ? { tone: "wait" }
                        : { tone: "live", text: t(m.stateWorking) };
  const lineQueue =
    queue.length > 0 && line === queue.at(-1)!.content ? queue : undefined;
  return {
    activities,
    key,
    line,
    ...(lineQueue ? { lineQueue } : {}),
    outputs,
    plan,
    state,
    ...(unconfirmed ? { unconfirmedFollowUps: true as const } : {}),
  };
}

/**
 * The status line's entries since the latest group began. Thinking, with its
 * title, and a Runtime's own description of an Activity start a group; the
 * steps of each Activity follow. A command the Computer could not name adds
 * nothing, so the line keeps its last text, and a message is left out: it
 * is in the Room when its Activity arrives.
 */
function statusLineQueue(
  marks: readonly RuntimeStatusMark[],
  activities: readonly RuntimeActivityPresentation[],
  t: Translate,
): AgentStatusLineItem[] {
  const byId = new Map(
    activities.map((activity) => [activity.activityId, activity]),
  );
  let items: { key: string; text: string; runningActivityId?: string }[] = [];
  for (const mark of marks) {
    if (mark.type === "thinking") {
      items = [
        { key: mark.key, text: mark.title?.trim() || t(m.stateThinking) },
      ];
      continue;
    }
    const activity = byId.get(mark.activityId);
    if (
      !activity ||
      activity.kind === "message" ||
      activity.kind === "recovery" ||
      activity.kind === "interaction"
    )
      continue;
    const running =
      activity.outcome === undefined
        ? { runningActivityId: activity.activityId }
        : {};
    const named = activityStatusLine(
      t,
      activity.kind,
      toolInputFromEntries(activity.entries),
    );
    if (named.title) {
      items = [
        { key: `${activity.activityId}:title`, text: named.title, ...running },
      ];
      continue;
    }
    named.steps.forEach((text, index) => {
      const last = index === named.steps.length - 1;
      const item = {
        key: `${activity.activityId}:${index}`,
        text,
        ...(last ? running : {}),
      };
      // The same words twice in a row stay one entry, keeping its key so the
      // line does not replay them.
      const previous = items.at(-1);
      if (previous?.text === text)
        items[items.length - 1] = { ...item, key: previous.key };
      else items.push(item);
    });
  }
  return items.map(({ key, text, runningActivityId }) => ({
    key,
    content: {
      tone: "live",
      text,
      ...(runningActivityId === undefined ? {} : { runningActivityId }),
    },
  }));
}

function activitySummary(activity: RuntimeActivityPresentation, t: Translate) {
  if (activity.kind === "interaction") return t(m.stateWaitingForInput);
  if (activity.kind === "response") return t(m.preparingReply);
  return toolPresentation(t, activity.kind).summary;
}

function createAgentRunStatusView(
  runStatus: TeamHubRunStatus,
  history: readonly AgentRuntimeStatusSegment[],
  highlightedSegmentKey: string,
): AgentRunStatusView {
  const highlighted =
    history.find((segment) => segment.key === highlightedSegmentKey) ??
    history[history.length - 1]!;
  return {
    ...highlighted,
    runStatus,
    highlightedSegmentKey: highlighted.key,
    history,
  };
}

export function avatarStatus(
  row: AgentRunStatusView,
  t: Translate,
): AgentAvatarStatus {
  return {
    status: t(stateLabels[row.state]),
    activities: row.activities.flatMap((activity) =>
      activity.outcome
        ? []
        : [{ id: activity.activityId, label: activitySummary(activity, t) }],
    ),
  };
}

interface AgentStreamingDockEntry {
  agent: {
    display_name: string;
    id: string;
    kind: "agent";
  };
  key: string;
  /** The Run the entry shows; a local typing entry has none. */
  runId?: string;
  runtimeStatus?: AgentRunStatusView;
}

/** An Agent the Dock shows as starting without a Run, such as paced setup. */
export interface AgentStreamingTypingAgent {
  display_name: string;
  id: string;
}

const EMPTY_SCOPE_KEY: readonly string[] = [];
const EMPTY_AGENT_RUNTIME_UPDATED_AT: Readonly<Record<string, string>> = {};

export function AgentStreamingStatusDock({
  agentRuntimeUpdatedAtByActorId = EMPTY_AGENT_RUNTIME_UPDATED_AT,
  cancelRoomRun,
  redeliverRoomRun,
  runStatuses = EMPTY_RUN_STATUSES,
  onViewActivity,
  runtimePresentationEventsByRunStatusId = EMPTY_RUNTIME_EVENTS,
  scopeKey = EMPTY_SCOPE_KEY,
  typingAgent,
  waitingDecisionSince,
}: {
  /** Timestamp when each Agent's runtime config changed; stale Failed/Stopped dock entries older than this are omitted. */
  agentRuntimeUpdatedAtByActorId?: Readonly<Record<string, string>>;
  cancelRoomRun?: (
    runId: string,
    requestId: string,
  ) => Promise<TeamHubRoomRunCancelResult>;
  /** Resends a finished Run's unconfirmed follow-ups to its Agent. */
  redeliverRoomRun?: (runId: string) => Promise<TeamHubRoomRunRedeliverResult>;
  runStatuses?: readonly TeamHubRunStatus[];
  onViewActivity?: (
    runStatusId: string,
    agent: {
      display_name: string;
      id: string;
      kind: "agent";
    },
    runId?: string,
  ) => void;
  runtimePresentationEventsByRunStatusId?: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >;
  /** Scopes the Stop state to the Room or Thread that shows the Dock. */
  scopeKey?: readonly string[];
  /** Shown only while that Agent has no Run status; it offers no Stop. */
  typingAgent?: AgentStreamingTypingAgent;
  /**
   * For each Agent with a decision card still waiting on the current Human,
   * when its newest one was posted.
   */
  waitingDecisionSince?: ReadonlyMap<string, string>;
}) {
  const t = useT();
  const runtimeViewCache = useRef<RuntimeTimelineViewCache>(new Map());
  const [dismissedRunStatusIds, setDismissedRunStatusIds] = useState<
    readonly string[]
  >([]);
  const runtimeStatuses = useMemo(
    () =>
      dockRuntimeStatuses(
        runStatuses,
        runtimePresentationEventsByRunStatusId,
        runtimeViewCache.current,
        t,
        agentRuntimeUpdatedAtByActorId,
        dismissedRunStatusIds,
      ),
    [
      agentRuntimeUpdatedAtByActorId,
      dismissedRunStatusIds,
      runStatuses,
      runtimePresentationEventsByRunStatusId,
      t,
    ],
  );
  const entries = useMemo<AgentStreamingDockEntry[]>(() => {
    const next: AgentStreamingDockEntry[] = runtimeStatuses.map(
      (runtimeStatus) => ({
        agent: runtimeStatus.runStatus.agent,
        key: runtimeStatus.runStatus.agent.id,
        runId: runtimeStatus.runStatus.run_id,
        runtimeStatus,
      }),
    );
    if (!typingAgent) return next;
    // A new request replaces the Agent's old failure, but never a live Run.
    const existing = next.findIndex((entry) => entry.key === typingAgent.id);
    const typing = {
      agent: { ...typingAgent, kind: "agent" as const },
      key: typingAgent.id,
    };
    if (existing < 0) next.push(typing);
    else if (!isLiveAgentRunStatus(next[existing]!.runtimeStatus!))
      next[existing] = typing;
    return next;
  }, [runtimeStatuses, typingAgent]);
  const workingEntries = entries.filter(
    (entry) =>
      entry.runtimeStatus?.state !== "Failed" &&
      entry.runtimeStatus?.state !== "Stopped" &&
      entry.runtimeStatus?.state !== "Needs attention",
  );
  useRoomRenderTiming("dock", {
    result: workingEntries.length ? "working" : "stopped",
    runStatusIds: workingEntries.flatMap((entry) =>
      entry.runtimeStatus ? [entry.runtimeStatus.runStatus.id] : [],
    ),
    runIds: workingEntries.flatMap((entry) =>
      entry.runId ? [entry.runId] : [],
    ),
  });

  if (entries.length === 0) return null;

  return (
    <AgentStreamingStatusDockBody
      cancelRoomRun={cancelRoomRun}
      entries={entries}
      onDismiss={(runStatusId) =>
        setDismissedRunStatusIds((prev) =>
          prev.includes(runStatusId) ? prev : [...prev, runStatusId],
        )
      }
      onViewActivity={onViewActivity}
      redeliverRoomRun={redeliverRoomRun}
      scopeKey={scopeKey}
      t={t}
      waitingDecisionSince={waitingDecisionSince}
    />
  );
}

function AgentStreamingStatusDockBody({
  cancelRoomRun,
  entries,
  onDismiss,
  onViewActivity,
  redeliverRoomRun,
  scopeKey,
  t,
  waitingDecisionSince,
}: {
  cancelRoomRun?: (
    runId: string,
    requestId: string,
  ) => Promise<TeamHubRoomRunCancelResult>;
  entries: readonly AgentStreamingDockEntry[];
  onDismiss: (runStatusId: string) => void;
  onViewActivity?: (
    runStatusId: string,
    agent: {
      display_name: string;
      id: string;
      kind: "agent";
    },
    runId?: string,
  ) => void;
  redeliverRoomRun?: (runId: string) => Promise<TeamHubRoomRunRedeliverResult>;
  scopeKey: readonly string[];
  t: Translate;
  waitingDecisionSince?: ReadonlyMap<string, string>;
}) {
  // Mounted only while entries exist, so dismissing the last entry resets
  // hover/focus state automatically without leaving rotation paused.
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLSpanElement>(null);
  const workingEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.runtimeStatus?.state !== "Failed" &&
          entry.runtimeStatus?.state !== "Stopped" &&
          entry.runtimeStatus?.state !== "Needs attention",
      ),
    [entries],
  );
  const hasMultipleWorking = workingEntries.length > 1;
  const selectedEntry =
    hasMultipleWorking && selectedAgentId
      ? workingEntries.find((entry) => entry.key === selectedAgentId)
      : undefined;
  useEffect(() => {
    if (!hasMultipleWorking) {
      setMenuOpen(false);
      return;
    }
    const node = menuWrapperRef.current;
    if (!node || typeof MutationObserver === "undefined") return;
    const sync = () =>
      setMenuOpen(Boolean(node.querySelector('[aria-expanded="true"]')));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["aria-expanded"],
      subtree: true,
    });
    return () => observer.disconnect();
  }, [hasMultipleWorking]);
  const lineTargets = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.key,
        content: dockEntryLine(entry, waitingDecisionSince, t),
        ...(entry.runtimeStatus?.lineQueue
          ? { queue: entry.runtimeStatus.lineQueue }
          : {}),
      })),
    [entries, waitingDecisionSince, t],
  );
  const activeLineTargets = useMemo(
    () =>
      selectedEntry
        ? lineTargets.filter((target) => target.id === selectedEntry.key)
        : lineTargets,
    [lineTargets, selectedEntry],
  );
  const line = useAgentStatusLine(
    activeLineTargets,
    hovered || menuOpen || Boolean(selectedEntry),
  );

  const failedCount = entries.filter(
    (entry) =>
      entry.runtimeStatus?.state === "Failed" ||
      entry.runtimeStatus?.state === "Stopped",
  ).length;
  const attentionCount = entries.filter(
    (entry) => entry.runtimeStatus?.state === "Needs attention",
  ).length;
  const openActivityLabel =
    failedCount || attentionCount
      ? t(m.openAgentStatusActivity)
      : t(m.openAgentsWorkingActivity);
  const shownEntry = entries.find((entry) => entry.key === line.current?.id);
  const shownActivity = shownEntry?.runtimeStatus
    ? {
        runStatusId: shownEntry.runtimeStatus.runStatus.id,
        runId: shownEntry.runtimeStatus.runStatus.run_id,
      }
    : undefined;
  const openShownActivity = () => {
    if (!shownActivity || !shownEntry) return;
    if (shownActivity.runId) {
      onViewActivity?.(
        shownActivity.runStatusId,
        shownEntry.agent,
        shownActivity.runId,
      );
    } else {
      onViewActivity?.(shownActivity.runStatusId, shownEntry.agent);
    }
  };
  const agentSelectorItems: ActionMenuItem[] = hasMultipleWorking
    ? [
        ...workingEntries.map((entry) => ({
          icon: (
            <ActorAvatar
              actorId={entry.agent.id}
              kind="agent"
              name={entry.agent.display_name}
              size="micro"
            />
          ),
          label: `${entry.agent.display_name}${entry.key === selectedEntry?.key ? " (Selected)" : ""} · ${statusLineText(dockEntryLine(entry, waitingDecisionSince, t), t)}`,
          onSelect: () => {
            setMenuOpen(false);
            setSelectedAgentId(entry.key);
          },
        })),
        ...(selectedEntry
          ? [
              {
                label: "Auto-rotate all",
                onSelect: () => {
                  setMenuOpen(false);
                  setSelectedAgentId(null);
                },
                separatorBefore: true,
              },
            ]
          : []),
      ]
    : [];

  return (
    // Keep the dock in normal flow above the composer so it never collides with
    // floating jump controls, background tasks, or composer peek avatars.
    <div
      className="room-readable relative z-10 bg-app-surface pb-1"
      data-testid="agent-streaming-status-dock"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHovered(false);
      }}
      onFocus={() => setHovered(true)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="flex min-h-7 max-w-full items-center gap-1">
        <button
          aria-label={openActivityLabel}
          className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-xs text-app-muted transition-colors hover:bg-app-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-focus disabled:hover:bg-transparent"
          disabled={!shownActivity}
          onClick={openShownActivity}
          title={
            shownEntry && line.current
              ? t(m.labeled, {
                  label: shownEntry.agent.display_name,
                  value: statusLineText(line.current.content, t),
                })
              : undefined
          }
          type="button"
        >
          <StatusLineRoll
            className="size-5 shrink-0"
            current={line.current}
            previous={line.previous}
            itemKey={(shown) => shown.id}
            render={(shown) => {
              const entry = entries.find((item) => item.key === shown.id);
              return (
                <ActorAvatar
                  actorId={shown.id}
                  kind="agent"
                  name={entry?.agent.display_name ?? ""}
                  size="xxs"
                />
              );
            }}
          />
          <StatusLineRoll
            className="h-4 min-w-0 flex-1"
            current={line.current}
            live
            previous={line.previous}
            itemKey={(shown) => `${shown.id}:${shown.key}`}
            render={(shown) => (
              <StatusLineText content={shown.content} minutes={shown.minutes} />
            )}
          />
        </button>
        {hasMultipleWorking ? (
          <span className="shrink-0" ref={menuWrapperRef}>
            <ActionMenu
              buttonClassName="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-2xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-focus"
              items={agentSelectorItems}
              label={t(m.agentsWorking, { count: workingEntries.length })}
              placement="top-start"
              trigger={
                <>
                  <span>
                    {t(m.agentsWorking, { count: workingEntries.length })}
                  </span>
                  <Icon icon={ArrowDown01Icon} size={14} />
                </>
              }
            />
          </span>
        ) : null}
        {onViewActivity && shownActivity && shownEntry ? (
          <button
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-app-muted transition-colors hover:bg-app-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-focus"
            onClick={openShownActivity}
            title={t(m.openAgentActivity, {
              name: shownEntry.agent.display_name,
            })}
            type="button"
          >
            {t(m.activity)}
          </button>
        ) : null}
        {shownEntry ? (
          <>
            <DockEntryStop
              cancelRoomRun={cancelRoomRun}
              entry={shownEntry}
              scopeKey={scopeKey}
            />
            <DockEntryResend
              entry={shownEntry}
              redeliverRoomRun={redeliverRoomRun}
              scopeKey={scopeKey}
            />
            <DockEntryDismiss entry={shownEntry} onDismiss={onDismiss} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Reports whether `AgentStreamingStatusDock` will render a visible bar. */
export function hasAgentStreamingDockEntries({
  runStatuses = EMPTY_RUN_STATUSES,
  runtimePresentationEventsByRunStatusId = EMPTY_RUNTIME_EVENTS,
  typingAgent,
}: {
  runStatuses?: readonly TeamHubRunStatus[];
  runtimePresentationEventsByRunStatusId?: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >;
  typingAgent?: AgentStreamingTypingAgent;
}): boolean {
  if (typingAgent) return true;
  return (
    dockRuntimeStatuses(runStatuses, runtimePresentationEventsByRunStatusId)
      .length > 0
  );
}

function DockEntryStop({
  cancelRoomRun,
  entry,
  scopeKey,
}: {
  cancelRoomRun?: (
    runId: string,
    requestId: string,
  ) => Promise<TeamHubRoomRunCancelResult>;
  entry: AgentStreamingDockEntry;
  scopeKey: readonly string[];
}) {
  const { runId, runtimeStatus } = entry;
  if (
    !runId ||
    !cancelRoomRun ||
    !runtimeStatus ||
    !isLiveAgentRunStatus(runtimeStatus)
  )
    return null;
  // The status line keeps Stop mounted, so a new Run gets a new button and
  // request ID; a stop in flight is still found through its Run.
  return (
    <AgentRunStopButton
      cancel={(requestId) => cancelRoomRun(runId, requestId)}
      controlKey={entry.agent.id}
      key={runId}
      runId={runId}
      name={entry.agent.display_name}
      scopeKey={scopeKey}
    />
  );
}

function DockEntryResend({
  entry,
  redeliverRoomRun,
  scopeKey,
}: {
  entry: AgentStreamingDockEntry;
  redeliverRoomRun?: (runId: string) => Promise<TeamHubRoomRunRedeliverResult>;
  scopeKey: readonly string[];
}) {
  const { runId, runtimeStatus } = entry;
  if (!runId || !redeliverRoomRun || !runtimeStatus?.unconfirmedFollowUps)
    return null;
  return (
    <AgentRunResendButton
      controlKey={entry.agent.id}
      key={runId}
      name={entry.agent.display_name}
      redeliver={() => redeliverRoomRun(runId)}
      runId={runId}
      scopeKey={scopeKey}
    />
  );
}

function DockEntryDismiss({
  entry,
  onDismiss,
}: {
  entry: AgentStreamingDockEntry;
  onDismiss: (runStatusId: string) => void;
}) {
  const t = useT();
  const { runtimeStatus } = entry;
  if (!runtimeStatus || !isTerminalDockStatus(runtimeStatus)) return null;
  const label = t(m.dismissAgentStatus, { name: entry.agent.display_name });
  return (
    <Button
      aria-label={label}
      className="size-7 shrink-0 text-app-subtle hover:bg-transparent hover:text-app-ink"
      data-voice-close
      onClick={() => onDismiss(runtimeStatus.runStatus.id)}
      size="compactIcon"
      title={label}
      tone="ghost"
      type="button"
    >
      <Icon icon={Cancel01Icon} size={14} />
    </Button>
  );
}

function isTerminalDockStatus(row: AgentRunStatusView): boolean {
  return (
    row.state === "Failed" ||
    row.state === "Stopped" ||
    row.state === "Needs attention"
  );
}

function isTimestampAfter(later: string, earlier: string): boolean {
  const laterMs = Date.parse(later);
  const earlierMs = Date.parse(earlier);
  if (!Number.isNaN(laterMs) && !Number.isNaN(earlierMs)) {
    return laterMs > earlierMs;
  }
  return later > earlier;
}

function dockRuntimeStatuses(
  runStatuses: readonly TeamHubRunStatus[],
  runtimePresentationEventsByRunStatusId: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >,
  cache?: RuntimeTimelineViewCache,
  t: Translate = translate,
  agentRuntimeUpdatedAtByActorId: Readonly<Record<string, string>> = {},
  dismissedRunStatusIds: readonly string[] = [],
) {
  const latestByAgent = new Map<string, TeamHubRunStatus>();
  for (const runStatus of runStatuses) {
    const current = latestByAgent.get(runStatus.agent.id);
    // A working Run wins over ended ones so its Stop stays reachable; among
    // equals, Run order follows creation, not a delayed update to an older
    // failure.
    const working = isRunWorking(runStatus);
    if (
      !current ||
      (working && !isRunWorking(current)) ||
      (working === isRunWorking(current) &&
        (current.created_at < runStatus.created_at ||
          (current.created_at === runStatus.created_at &&
            current.id < runStatus.id)))
    ) {
      latestByAgent.set(runStatus.agent.id, runStatus);
    }
  }
  // Select before projection: a completed Run may have no displayable history.
  return buildRuntimeTimelineViews({
    cache,
    runStatuses: [...latestByAgent.values()],
    runtimePresentationEventsByRunStatusId,
    t,
  }).filter((row) => {
    if (isLiveAgentRunStatus(row)) return true;
    if (!isTerminalDockStatus(row)) return false;
    if (dismissedRunStatusIds.includes(row.runStatus.id)) return false;
    // Never auto-hide Needs attention or runs with unconfirmed follow-ups so
    // the user's Resend action stays reachable.
    if (
      (row.state === "Failed" || row.state === "Stopped") &&
      !row.unconfirmedFollowUps
    ) {
      const agentRuntimeUpdatedAt =
        agentRuntimeUpdatedAtByActorId[row.runStatus.agent.id];
      if (
        agentRuntimeUpdatedAt &&
        isTimestampAfter(agentRuntimeUpdatedAt, row.runStatus.updated_at)
      ) {
        return false;
      }
    }
    return true;
  });
}

function dockEntryLine(
  entry: AgentStreamingDockEntry,
  waitingDecisionSince: ReadonlyMap<string, string> | undefined,
  t: Translate,
): AgentStatusLineContent {
  const status = entry.runtimeStatus;
  if (!status) return { tone: "wait" };
  // A Run that ended after its Agent asked this Human for something, such as
  // a macOS permission, is waiting on them, not broken. A card from before
  // the Run says nothing about why this Run ended.
  const cardAt = waitingDecisionSince?.get(entry.key);
  if (
    (status.state === "Failed" || status.state === "Stopped") &&
    cardAt !== undefined &&
    Date.parse(cardAt) >= Date.parse(status.runStatus.created_at)
  )
    return { tone: "waiting", text: t(m.waitingForDecision) };
  return status.line;
}

function statusLineText(content: AgentStatusLineContent, t: Translate) {
  return content.tone === "wait" ? t(m.starting) : content.text;
}

/** The line's text; a long-running Activity's minutes follow it directly. */
function StatusLineText({
  content,
  minutes,
}: {
  content: AgentStatusLineContent;
  minutes?: number;
}) {
  const t = useT();
  if (content.tone === "wait")
    return (
      <>
        <TypingDots className="text-app-subtle" />
        <span className="sr-only">{t(m.starting)}</span>
      </>
    );
  const ended =
    content.tone === "danger" ||
    content.tone === "warn" ||
    content.tone === "waiting";
  const text = (
    <span
      className={cn(
        "block min-w-0 truncate leading-4",
        content.tone === "live" && "town-status-shimmer",
        content.tone === "muted" && "text-app-subtle",
        ended && "text-app-muted",
      )}
    >
      {content.text}
    </span>
  );
  // An ended Run reads as a quiet note: an amber dot, never error red, so a
  // hiccup does not look like a broken product. The line opens the Activity
  // panel, where the full reason is.
  if (ended)
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-app-warning",
            content.tone === "waiting" && "motion-safe:animate-pulse",
          )}
        />
        {text}
        {content.tone === "danger" ? (
          <span className="shrink-0 leading-4 text-app-subtle underline decoration-app-border-strong underline-offset-2">
            {t(m.details)}
          </span>
        ) : null}
      </span>
    );
  if (!minutes) return text;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {text}
      <span className="shrink-0 leading-4 text-app-subtle tabular-nums">
        · {t(m.elapsedMinutes, { minutes })}
      </span>
    </span>
  );
}

/** Rolls a new item up from below while the previous one leaves the top. */
function StatusLineRoll({
  className,
  current,
  itemKey,
  live = false,
  previous,
  render,
}: {
  className: string;
  current?: AgentStatusLineShown;
  itemKey: (shown: AgentStatusLineShown) => string;
  live?: boolean;
  previous?: AgentStatusLineShown;
  render: (shown: AgentStatusLineShown) => ReactNode;
}) {
  const currentKey = current ? itemKey(current) : undefined;
  return (
    <span
      aria-live={live ? "polite" : undefined}
      className={cn("grid grid-cols-1 overflow-hidden", className)}
      role={live ? "status" : undefined}
    >
      {previous && itemKey(previous) !== currentKey ? (
        <span
          aria-hidden="true"
          className="town-status-roll-out col-start-1 row-start-1 flex min-w-0 items-center"
          key={`out:${itemKey(previous)}`}
        >
          {render(previous)}
        </span>
      ) : null}
      {current ? (
        <span
          className="town-status-roll-in col-start-1 row-start-1 flex min-w-0 items-center"
          key={`in:${currentKey}`}
        >
          {render(current)}
        </span>
      ) : null}
    </span>
  );
}
