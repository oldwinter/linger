import type { RefCallback } from "react";
import { Link } from "react-router";

import { ActorAvatar } from "@/features/rooms/members/actor-avatar";
import type {
  TeamHubRoomListItem,
  TeamHubWorkItem,
} from "@/features/teamhub/teamhub-types";
import { formatLocale, type Translate } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { WorkItemCardMenu } from "./work-item-card-menu";
import { formatWorkItemDate } from "./work-item-format";
import {
  workItemPriorityBadgeClassName,
  workItemPriorityLabel,
} from "./work-item-labels";
import { dashboardWorkItemPath } from "./work-item-routes";
import { workItemStoryPath } from "./work-item-story";
import {
  dashboardColumnFor,
  type DashboardColumnId,
} from "./work-item-transitions";
import type { useWorkItemSelection } from "./use-work-item-selection";
import { workItemsMessages as m } from "./work-items.messages";
import { workItemsViewMessages as vm } from "./work-items-view.messages";

export interface WorkItemListViewProps {
  focusedCardRef: RefCallback<HTMLAnchorElement>;
  focusedWorkItemId?: string;
  items: readonly TeamHubWorkItem[];
  onDuplicate: (item: TeamHubWorkItem) => void;
  onPeek: (item: TeamHubWorkItem, card: HTMLAnchorElement) => void;
  originRoomLabel: (item: TeamHubWorkItem) => string;
  rooms: readonly TeamHubRoomListItem[];
  search: string;
  selection: ReturnType<typeof useWorkItemSelection>;
  tenantId: string;
}

/** Crisp, scannable table view of Dashboard Work Items with full selection and actions. */
export function WorkItemListView({
  focusedCardRef,
  focusedWorkItemId,
  items,
  onDuplicate,
  onPeek,
  originRoomLabel,
  rooms,
  search,
  selection,
  tenantId,
}: WorkItemListViewProps) {
  const { language, t } = useTranslation();
  const locale = formatLocale(language);
  const roomsById = new Map(rooms.map((room) => [room.id, room] as const));

  return (
    <div className="workspace-scrollbar min-h-0 flex-1 overflow-auto p-4 sm:p-5">
      <div className="overflow-x-auto rounded-xl border border-app-border bg-card shadow-xs">
        <table
          aria-label={t(vm.workItemsList)}
          className="w-full min-w-[820px] border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b border-app-border bg-muted/40 text-xs font-medium text-muted-foreground">
              <th className="w-10 px-3 py-2.5">
                <input
                  aria-label={t(vm.selectAllItems)}
                  checked={items.length > 0 && selection.allSelected}
                  className="size-4 cursor-pointer accent-primary"
                  disabled={selection.pending || items.length === 0}
                  onChange={() =>
                    selection.allSelected
                      ? selection.deselectAll()
                      : selection.selectAll()
                  }
                  type="checkbox"
                />
              </th>
              <th className="w-20 px-3 py-2.5">{t(vm.columnId)}</th>
              <th className="px-3 py-2.5">{t(vm.columnTitle)}</th>
              <th className="w-32 px-3 py-2.5">{t(vm.columnStatus)}</th>
              <th className="w-28 px-3 py-2.5">{t(vm.columnPriority)}</th>
              <th className="w-36 px-3 py-2.5">{t(vm.columnAssignees)}</th>
              <th className="w-36 px-3 py-2.5">{t(vm.columnOriginRoom)}</th>
              <th className="w-40 px-3 py-2.5">{t(vm.columnExecution)}</th>
              <th className="w-32 px-3 py-2.5">{t(vm.columnUpdated)}</th>
              <th className="w-36 px-3 py-2.5 text-right">
                {t(vm.columnActions)}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {items.map((item) => {
              const status = dashboardColumnFor(item);
              const originRoom = item.origin_room_id
                ? roomsById.get(item.origin_room_id)
                : undefined;
              const selected = selection.isSelected(item.id);
              const isFocused = item.id === focusedWorkItemId;
              return (
                <tr
                  className={cn(
                    "transition-colors hover:bg-app-hover/60",
                    selected && "bg-app-selected/40",
                    isFocused && "bg-app-selected/60",
                  )}
                  key={item.id}
                >
                  <td className="px-3 py-2.5 align-middle">
                    <input
                      aria-label={t(vm.selectItem, { title: item.title })}
                      checked={selected}
                      className="size-4 cursor-pointer accent-primary"
                      onChange={() => selection.toggle(item.id)}
                      type="checkbox"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs font-medium tabular-nums text-muted-foreground">
                    #{item.number}
                  </td>
                  <td className="max-w-sm px-3 py-2.5 align-middle">
                    <Link
                      aria-current={isFocused ? "location" : undefined}
                      className="block font-medium text-foreground [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                      data-work-item-id={item.id}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onPeek(item, event.currentTarget);
                      }}
                      ref={isFocused ? focusedCardRef : undefined}
                      to={{
                        pathname: dashboardWorkItemPath(tenantId, item.id),
                        search,
                      }}
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                    <ListStatusBadge status={status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                    <span
                      className={cn(
                        "inline-flex border px-1.5 py-0.5 text-xs font-medium leading-4 [border-radius:var(--app-pill-radius)]",
                        workItemPriorityBadgeClassName(item.priority),
                      )}
                      data-priority={item.priority}
                    >
                      {workItemPriorityLabel(item.priority, t)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    {item.assignees.length ? (
                      <span
                        aria-label={t(m.assignedTo, {
                          names: item.assignees
                            .map(({ actor }) => actor.display_name)
                            .join(", "),
                        })}
                        className="flex items-center -space-x-1"
                        role="group"
                      >
                        {item.assignees.slice(0, 4).map(({ actor }) => (
                          <span
                            className="rounded-full ring-2 ring-card"
                            key={actor.id}
                            title={actor.display_name}
                          >
                            <ActorAvatar
                              actorId={actor.id}
                              kind={actor.kind}
                              name={actor.display_name}
                              size="micro"
                            />
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t(m.unassigned)}
                      </span>
                    )}
                  </td>
                  <td className="max-w-36 truncate px-3 py-2.5 align-middle text-xs">
                    {originRoom ? (
                      <Link
                        className="font-medium text-app-link hover:underline"
                        to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(originRoom.id)}/chat`}
                      >
                        {originRoomLabel(item)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {originRoomLabel(item)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                    {item.task_execution ? (
                      <ExecutionBadge
                        status={item.task_execution.status}
                        t={t}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs tabular-nums text-muted-foreground">
                    <time dateTime={item.updated_at}>
                      {formatWorkItemDate(item.updated_at, locale)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <Link
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to={workItemStoryPath(tenantId, item.id)}
                      >
                        {t(m.whatHappened)}
                      </Link>
                      <WorkItemCardMenu
                        item={item}
                        onDuplicate={onDuplicate}
                        tenantId={tenantId}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListStatusBadge({ status }: { status: DashboardColumnId }) {
  const { t } = useTranslation();
  const label =
    status === "todo"
      ? t(m.columnTodo)
      : status === "in-progress"
        ? t(m.columnInProgress)
        : status === "done"
          ? t(m.columnDone)
          : t(m.columnClosed);
  return (
    <span className="work-item-status" data-status={status}>
      <span>{label}</span>
    </span>
  );
}

function ExecutionBadge({
  status,
  t,
}: {
  status: NonNullable<TeamHubWorkItem["task_execution"]>["status"];
  t: Translate;
}) {
  const label =
    status === "running"
      ? t(m.executionAgentRunning)
      : status === "waiting_for_approval"
        ? t(m.executionWaitingForApproval)
        : status === "failed"
          ? t(m.executionAgentFailed)
          : status === "canceled"
            ? t(m.executionAgentCanceled)
            : t(m.executionAgentIdle);
  const toneClass =
    status === "failed"
      ? "border-(--app-status-danger-border) bg-(--app-status-danger-surface) text-(--app-status-danger-text)"
      : status === "waiting_for_approval"
        ? "border-(--app-status-warning-border) bg-(--app-status-warning-surface) text-(--app-status-warning-text)"
        : status === "running"
          ? "border-(--app-mention-surface) bg-(--app-mention-surface) text-(--app-mention-text)"
          : "border-app-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}
