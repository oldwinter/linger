import { dateTimeFormat } from "@/lib/date-format";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CheckListIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefCallback,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Select, SelectItem } from "@/components/ui/select";
import {
  teamHubIdentityQueryOptions,
  tenantRoomsQueryOptions,
} from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { AuthenticatedRouteLoading } from "@/features/rooms/route-loading-surface";
import { ActorAvatar } from "@/features/rooms/members/actor-avatar";
import { TeamHubError } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  createWorkItemDashboardFilters,
  currentDashboardActorId,
  hasWorkItemDashboardFilters,
  WORK_ITEM_DASHBOARD_ASSIGNMENTS,
  WORK_ITEM_DASHBOARD_EXECUTION_STATUSES,
  WORK_ITEM_DASHBOARD_PRIORITIES,
  workItemDashboardFiltersSearch,
  type WorkItemDashboardAssignment,
  type WorkItemDashboardExecutionStatus,
  type WorkItemDashboardFilters,
  type WorkItemDashboardPriority,
} from "./work-item-dashboard-filters";
import { WorkItemPeek } from "./work-item-peek";
import {
  tenantWorkItemTargetQueryOptions,
  tenantWorkItemsDashboardQueryOptions,
} from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { createWorkItemRoomFilterModel } from "./work-item-room-filter";

interface DashboardColumn {
  id: "todo" | "in-progress" | "done" | "closed";
  label: "Todo" | "In progress" | "Done" | "Closed";
}

const dashboardColumns: readonly DashboardColumn[] = [
  { id: "todo", label: "Todo" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "closed", label: "Closed" },
];

const dashboardDateFormatter = dateTimeFormat({
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const priorityLabels: Record<WorkItemDashboardPriority, string> = {
  high: "High",
  low: "Low",
  medium: "Medium",
  urgent: "Urgent",
};

const executionLabels: Record<WorkItemDashboardExecutionStatus, string> = {
  canceled: "Agent canceled",
  failed: "Agent failed",
  idle: "Agent idle",
  running: "Agent running",
  waiting_for_approval: "Waiting for approval",
};

const assignmentLabels = {
  all: "All",
  mine: "Mine",
  unassigned: "Unassigned",
} as const;

export function WorkItemsPage() {
  const { client } = useTeamHubRuntime();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const focusedWorkItemId = params.workItemId;
  const focusedCardRef = useCallback<RefCallback<HTMLAnchorElement>>(
    (card) => {
      if (focusedWorkItemId) card?.focus();
    },
    [focusedWorkItemId],
  );
  const [peekWorkItem, setPeekWorkItem] = useState<TeamHubWorkItem>();
  const peekTrigger = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!peekWorkItem) return;
    // Leaving the peek, however it closes, puts the reader back on its card. A
    // transition can move the card to another column, replacing its element, so
    // fall back to the card that now carries the Item.
    return () => {
      const trigger = peekTrigger.current?.isConnected
        ? peekTrigger.current
        : cardForWorkItem(peekWorkItem.id);
      trigger?.focus();
    };
  }, [peekWorkItem]);
  function openPeek(item: TeamHubWorkItem, card: HTMLAnchorElement) {
    peekTrigger.current = card;
    setPeekWorkItem(item);
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = createWorkItemDashboardFilters(searchParams);
  const identityQuery = useQuery(teamHubIdentityQueryOptions(client));
  const currentActorId = identityQuery.data
    ? currentDashboardActorId(identityQuery.data, tenantId)
    : undefined;
  const workItemsQuery = useQuery({
    ...tenantWorkItemsDashboardQueryOptions(
      client,
      tenantId,
      filters,
      currentActorId,
    ),
    // Mine cannot be requested before the identity names the current Actor.
    enabled: filters.assignment !== "mine" || identityQuery.isSuccess,
  });
  const focusedWorkItemQuery = useQuery({
    ...tenantWorkItemTargetQueryOptions(
      client,
      tenantId,
      focusedWorkItemId ?? "",
    ),
    enabled: Boolean(focusedWorkItemId),
  });
  const roomsQuery = useQuery(tenantRoomsQueryOptions(client, tenantId));

  if (
    workItemsQuery.isPending ||
    identityQuery.isPending ||
    roomsQuery.isPending ||
    (focusedWorkItemId && focusedWorkItemQuery.isPending)
  ) {
    return <WorkItemsLoading />;
  }
  const queryError =
    workItemsQuery.error ??
    identityQuery.error ??
    focusedWorkItemQuery.error ??
    roomsQuery.error;
  if (queryError) {
    return (
      <WorkItemsError
        error={queryError}
        isRetrying={
          workItemsQuery.isFetching ||
          identityQuery.isFetching ||
          focusedWorkItemQuery.isFetching ||
          roomsQuery.isFetching
        }
        onRetry={() => {
          if (workItemsQuery.isError) void workItemsQuery.refetch();
          if (identityQuery.isError) void identityQuery.refetch();
          if (focusedWorkItemQuery.isError) void focusedWorkItemQuery.refetch();
          if (roomsQuery.isError) void roomsQuery.refetch();
        }}
      />
    );
  }

  const data = workItemsQuery.data;
  const rooms = roomsQuery.data;
  if (!data || !rooms) return <WorkItemsLoading />;
  const items = mergeFocusedWorkItem(data.items, focusedWorkItemQuery.data);
  const roomFilter = createWorkItemRoomFilterModel(rooms.items, items);
  const filteredItems = items.filter(
    (item) =>
      roomFilter.matches(item, filters.room) &&
      (filters.assignment !== "unassigned" || item.assignees.length === 0),
  );
  const dashboardSearch = workItemDashboardFiltersSearch(filters);
  const showFilterBar =
    items.length > 0 || hasWorkItemDashboardFilters(filters);

  function updateFilters(next: WorkItemDashboardFilters) {
    setSearchParams(workItemDashboardFiltersSearch(next), { replace: true });
  }

  return (
    <main className="work-items-surface flex min-h-0 flex-1 flex-col overflow-hidden bg-app-surface">
      <header className="work-items-header shrink-0 border-b border-app-border px-5 py-3 sm:px-8">
        <div>
          <h1 className="text-2xl text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {filteredItems.length === items.length
              ? itemCount(items.length)
              : `${filteredItems.length} of ${items.length} items`}
          </p>
        </div>
        {showFilterBar ? (
          <div
            aria-label="Work Item filters"
            className="mt-3 flex flex-wrap items-center gap-2"
            role="group"
          >
            <Select
              aria-label="Room"
              onValueChange={(room) => updateFilters({ ...filters, room })}
              value={filters.room}
              variant="pill"
            >
              <SelectItem value="">All rooms</SelectItem>
              {roomFilter.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Priority"
              onValueChange={(priority) =>
                updateFilters({
                  ...filters,
                  priority: priority as WorkItemDashboardPriority | "",
                })
              }
              value={filters.priority}
              variant="pill"
            >
              <SelectItem value="">All priorities</SelectItem>
              {WORK_ITEM_DASHBOARD_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priorityLabels[priority]}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Assignment"
              onValueChange={(assignment) =>
                updateFilters({
                  ...filters,
                  assignment: assignment as WorkItemDashboardAssignment,
                })
              }
              value={filters.assignment}
              variant="pill"
            >
              {WORK_ITEM_DASHBOARD_ASSIGNMENTS.map((assignment) => (
                <SelectItem key={assignment} value={assignment}>
                  {assignmentLabels[assignment]}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Execution"
              onValueChange={(execution) =>
                updateFilters({
                  ...filters,
                  execution: execution as WorkItemDashboardExecutionStatus | "",
                })
              }
              value={filters.execution}
              variant="pill"
            >
              <SelectItem value="">All execution states</SelectItem>
              {WORK_ITEM_DASHBOARD_EXECUTION_STATUSES.map((execution) => (
                <SelectItem key={execution} value={execution}>
                  {executionLabels[execution]}
                </SelectItem>
              ))}
            </Select>
            <button
              aria-pressed={filters.archived}
              className="select-pill"
              onClick={() =>
                updateFilters({ ...filters, archived: !filters.archived })
              }
              type="button"
            >
              Archived
            </button>
          </div>
        ) : null}
      </header>

      {items.length || showFilterBar ? (
        <div className="work-items-board workspace-scrollbar min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-5">
          <div className="grid h-full min-w-[1180px] grid-cols-5 gap-3">
            {dashboardColumns.map((column) => (
              <WorkItemColumn
                column={column}
                focusedCardRef={focusedCardRef}
                focusedWorkItemId={focusedWorkItemId}
                items={filteredItems.filter(
                  (item) => dashboardColumnFor(item) === column.id,
                )}
                key={column.id}
                onPeek={openPeek}
                originRoomLabel={roomFilter.originLabel}
                search={dashboardSearch}
                tenantId={tenantId}
              />
            ))}
          </div>
        </div>
      ) : (
        <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center">
          <div>
            <span className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon icon={CheckListIcon} size={16} />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-app-ink">
              No Work Items yet
            </h2>
          </div>
        </section>
      )}

      {peekWorkItem ? (
        <WorkItemPeek
          key={peekWorkItem.id}
          onClose={() => setPeekWorkItem(undefined)}
          search={dashboardSearch}
          tenantId={tenantId}
          workItem={peekWorkItem}
        />
      ) : null}
    </main>
  );
}

/** The rendered card for a Work Item, wherever its column currently is. */
function cardForWorkItem(workItemId: string) {
  for (const card of document.querySelectorAll<HTMLAnchorElement>(
    "[data-work-item-id]",
  )) {
    if (card.dataset.workItemId === workItemId) return card;
  }
  return null;
}

function mergeFocusedWorkItem(
  items: TeamHubWorkItem[],
  focusedItem?: TeamHubWorkItem,
) {
  if (!focusedItem) return items;
  const focusedIndex = items.findIndex((item) => item.id === focusedItem.id);
  if (focusedIndex < 0) return [...items, focusedItem];
  if (items[focusedIndex]!.version >= focusedItem.version) return items;
  return items.map((item, index) =>
    index === focusedIndex ? focusedItem : item,
  );
}

function itemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function WorkItemsLoading() {
  return <AuthenticatedRouteLoading pathname="/dashboard" rooms={[]} />;
}

function WorkItemsError({
  error,
  isRetrying,
  onRetry,
}: {
  error: Error;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const forbidden = error instanceof TeamHubError && error.status === 403;
  return (
    <main
      aria-label="Dashboard error"
      className="work-items-surface flex min-h-0 flex-1 items-center justify-center bg-app-surface px-6 py-12 text-center"
      role="alert"
    >
      <div className="max-w-md">
        <h1 className="text-lg text-app-ink">
          {forbidden ? "Access denied" : "Dashboard unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          {error.message || "TeamHub could not load Work Items."}
        </p>
        <Button className="mt-5" disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </main>
  );
}

function WorkItemColumn({
  column,
  focusedCardRef,
  focusedWorkItemId,
  items,
  onPeek,
  originRoomLabel,
  search,
  tenantId,
}: {
  column: DashboardColumn;
  focusedCardRef: RefCallback<HTMLAnchorElement>;
  focusedWorkItemId?: string;
  items: TeamHubWorkItem[];
  onPeek: (item: TeamHubWorkItem, card: HTMLAnchorElement) => void;
  originRoomLabel: (item: TeamHubWorkItem) => string;
  search: string;
  tenantId: string;
}) {
  const [closedExpanded, setClosedExpanded] = useState(true);
  const isClosed = column.id === "closed";

  return (
    <section
      aria-label={column.label}
      className="work-item-column flex min-h-0 min-w-0 flex-col"
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <h2>
            <WorkItemStatus status={column.id} />
          </h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </span>
        {isClosed ? (
          <Button
            aria-controls="work-item-column-closed-items"
            aria-expanded={closedExpanded}
            aria-label={closedExpanded ? "Collapse closed" : "Expand closed"}
            onClick={() => setClosedExpanded((expanded) => !expanded)}
            size="compactIcon"
            title={closedExpanded ? "Collapse closed" : "Expand closed"}
            tone="ghost"
          >
            {closedExpanded ? (
              <Icon icon={ArrowDown01Icon} size={14} />
            ) : (
              <Icon icon={ArrowRight01Icon} size={14} />
            )}
          </Button>
        ) : null}
      </header>
      {!isClosed || closedExpanded ? (
        <ul
          className="workspace-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-2"
          id={isClosed ? "work-item-column-closed-items" : undefined}
        >
          {items.map((item) => (
            <li key={item.id}>
              <Link
                aria-current={
                  item.id === focusedWorkItemId ? "location" : undefined
                }
                className="work-item-card block px-3 py-2.5 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                data-work-item-id={item.id}
                onClick={(event) => {
                  // A plain click peeks at the Item; keyboard activation does
                  // the same. Modified clicks keep the full page for a new tab.
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onPeek(item, event.currentTarget);
                }}
                ref={item.id === focusedWorkItemId ? focusedCardRef : undefined}
                to={{
                  pathname: dashboardWorkItemPath(tenantId, item.id),
                  search,
                }}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold leading-5">
                    {item.title}
                  </span>
                  <span
                    className="work-item-priority shrink-0 border border-app-border-strong px-1.5 py-0.5 text-[12px] font-medium leading-4 text-app-body [border-radius:var(--app-pill-radius)]"
                    data-priority={item.priority}
                  >
                    {capitalize(item.priority)}
                  </span>
                </span>
                <span className="mt-2 flex min-w-0 items-center justify-between gap-2">
                  <span className="work-item-creator inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4 text-app-accent-text">
                    <ActorAvatar
                      actorId={item.created_by.id}
                      kind={item.created_by.kind}
                      name={item.created_by.display_name}
                      size="micro"
                    />
                    <span className="[overflow-wrap:anywhere]">
                      {item.created_by.display_name}
                    </span>
                  </span>
                  {item.assignees.length ? (
                    <span
                      aria-label={`Assigned to ${item.assignees.map(({ actor }) => actor.display_name).join(", ")}`}
                      className="flex shrink-0 -space-x-1"
                      role="group"
                    >
                      {item.assignees.slice(0, 4).map(({ actor }) => (
                        <span
                          className="rounded-full ring-2 ring-app-surface"
                          key={actor.id}
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
                  ) : null}
                </span>
                {item.mandate ? (
                  <WorkItemMandateNote mandate={item.mandate} />
                ) : null}
                <span className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-app-border pt-2 text-[12px] leading-4 text-app-subtle">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="[overflow-wrap:anywhere]">
                      {originRoomLabel(item)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">
                      {item.kind === "issue" ? "Issue" : "Task"} #{item.number}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <WorkItemStatus compact status={column.id} />
                    <time dateTime={item.updated_at}>
                      {formatDashboardDate(item.updated_at)}
                    </time>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Why Another Me created this Work Item: the Human's rule it acted under. */
function WorkItemMandateNote({
  mandate,
}: {
  mandate: NonNullable<TeamHubWorkItem["mandate"]>;
}) {
  return (
    <span className="mt-2 block text-[12px] leading-4 text-app-subtle [overflow-wrap:anywhere]">
      {mandate.strength === "create_and_delegate"
        ? "Created and delegated"
        : "Created"}{" "}
      by Another Me under your rule “{mandate.rule_text}”
      {mandate.revoked ? " · mandate revoked" : ""}
    </span>
  );
}

function WorkItemStatus({
  compact = false,
  status,
}: {
  compact?: boolean;
  status: DashboardColumn["id"];
}) {
  const column = dashboardColumns.find((candidate) => candidate.id === status)!;

  return (
    <span
      className="work-item-status"
      data-compact={compact ? "true" : "false"}
      data-status={status}
    >
      <span>{column.label}</span>
    </span>
  );
}

function dashboardColumnFor(item: TeamHubWorkItem): DashboardColumn["id"] {
  if (item.state === "open") return "todo";
  if (item.state === "in_progress") return "in-progress";
  return item.resolution === "completed" ? "done" : "closed";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDashboardDate(value: string) {
  return dashboardDateFormatter.format(new Date(value));
}
