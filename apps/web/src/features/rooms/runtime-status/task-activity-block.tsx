import {
  SentIcon,
  TaskAdd01Icon,
  TaskDaily01Icon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubTaskExecution } from "@/features/teamhub/teamhub-types";
import { tenantWorkItemTargetQueryOptions } from "@/features/work-items/work-item-queries";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { RunningDots } from "../task-sidebar/running-dots";
import { runtimeStatusMessages as m } from "./runtime-status.messages";
import type { TaskCommand } from "./task-command";

interface TaskActivityLinks {
  tenantId: string;
  openTask?: (taskId: string, title: string) => void;
}

const TaskActivityLinksContext = createContext<TaskActivityLinks | null>(null);

/** Lets task blocks inside an activity log read Tasks and open one. */
export function TaskActivityLinksProvider({
  children,
  openTask,
  tenantId,
}: TaskActivityLinks & { children: ReactNode }) {
  const links = useMemo(() => ({ openTask, tenantId }), [openTask, tenantId]);
  return (
    <TaskActivityLinksContext.Provider value={links}>
      {children}
    </TaskActivityLinksContext.Provider>
  );
}

const VERBS: Record<TaskCommand["operation"], Message<string>> = {
  create: m.taskStarted,
  send: m.taskSentTo,
  stop: m.taskStopped,
  check: m.tasksChecked,
};
const GLYPHS = {
  create: TaskAdd01Icon,
  send: SentIcon,
  stop: TaskDone01Icon,
  check: TaskDaily01Icon,
};

/**
 * One `teamhub task …` step of a Meta's activity: what it did, to which Task,
 * and that Task's current state. Opening it shows the Task's own activity.
 */
export function TaskActivityBlock({
  active = false,
  command,
  failed = false,
  taskId,
}: {
  active?: boolean;
  command: TaskCommand;
  failed?: boolean;
  taskId?: string;
}) {
  const t = useT();
  const links = useContext(TaskActivityLinksContext);
  const { client } = useTeamHubRuntime();
  const tenantId = links?.tenantId ?? "";
  const readable = Boolean(taskId && tenantId) && command.operation !== "check";
  const item = useQuery({
    ...tenantWorkItemTargetQueryOptions(client, tenantId, taskId ?? ""),
    enabled: readable && !command.name,
    retry: false,
  });
  const execution = useQuery({
    queryKey: ["teamhub", tenantId, "task-execution", taskId],
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tasks/{taskId}/execution", {
          params: { path: { taskId: taskId ?? "" } },
        }),
      ),
    enabled: readable,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ||
      query.state.data?.status === "waiting_for_approval"
        ? 5_000
        : false,
  });
  const title =
    command.operation === "check"
      ? undefined
      : (command.name ?? item.data?.title);
  const open =
    taskId && title !== undefined && links?.openTask
      ? () => links.openTask?.(taskId, title)
      : undefined;
  const row = (
    <>
      <Icon className="shrink-0" icon={GLYPHS[command.operation]} size={15} />
      <span className={`shrink-0 ${active ? "town-shimmer-text" : ""}`}>
        {t(VERBS[command.operation])}
      </span>
      <span className="min-w-0 flex-1 truncate text-app-ink">{title}</span>
      {failed ? (
        <span className="shrink-0 text-app-danger">
          {t(m.taskStatusFailed)}
        </span>
      ) : execution.data ? (
        <TaskState execution={execution.data} />
      ) : null}
    </>
  );
  const rowClass = "flex min-h-8 w-full items-center gap-2 py-1.5 text-left";
  return (
    <li className="runtime-activity-step text-app-muted">
      {open ? (
        <button
          aria-label={t(m.openTask, { title: title ?? "" })}
          className={`${rowClass} rounded-md hover:text-app-body focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-app-focus`}
          onClick={open}
          type="button"
        >
          {row}
        </button>
      ) : (
        <span className={rowClass}>{row}</span>
      )}
      {command.operation === "send" && command.message ? (
        <p className="-mt-1 mb-1 line-clamp-2 pl-[1.45rem] text-app-muted">
          “{command.message}”
        </p>
      ) : null}
    </li>
  );
}

function TaskState({ execution }: { execution: TeamHubTaskExecution }) {
  const t = useT();
  return execution.status === "running" ? (
    <span
      aria-label={t(m.taskRunning)}
      className="flex shrink-0 items-center text-app-info"
      role="img"
    >
      <RunningDots />
    </span>
  ) : (
    <TaskStatusPill status={execution.status} />
  );
}

/** A Task's execution state in a word, as its block and its conversation show it. */
export function TaskStatusPill({
  status,
}: {
  status: TeamHubTaskExecution["status"];
}) {
  const t = useT();
  switch (status) {
    case "running":
      return <StatusPill tone="neutral">{t(m.taskStatusRunning)}</StatusPill>;
    case "waiting_for_approval":
      return (
        <StatusPill tone="warning">{t(m.taskStatusNeedsApproval)}</StatusPill>
      );
    case "idle":
      return <StatusPill tone="success">{t(m.taskStatusFinished)}</StatusPill>;
    case "failed":
      return <StatusPill tone="danger">{t(m.taskStatusFailed)}</StatusPill>;
    case "canceled":
      return <StatusPill>{t(m.taskStatusStopped)}</StatusPill>;
  }
}
