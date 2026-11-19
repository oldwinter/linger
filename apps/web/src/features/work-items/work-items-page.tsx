import { dateTimeFormat } from "@/lib/date-format";
import { isShortcutKeyEvent } from "@/lib/keyboard-shortcut";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckListIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefCallback,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Select, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/cn";
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
  clearWorkItemDashboardFilters,
  createWorkItemDashboardFilters,
  currentDashboardActorId,
  hasWorkItemDashboardFilters,
  hasWorkItemDashboardNarrowingFilters,
  matchesWorkItemText,
  WORK_ITEM_DASHBOARD_ASSIGNMENTS,
  WORK_ITEM_DASHBOARD_EXECUTION_STATUSES,
  WORK_ITEM_DASHBOARD_PRIORITIES,
  WORK_ITEM_DASHBOARD_PRIORITY_LABELS,
  workItemDashboardFiltersSearch,
  type WorkItemDashboardAssignment,
  type WorkItemDashboardExecutionStatus,
  type WorkItemDashboardFilters,
  type WorkItemDashboardPriority,
} from "./work-item-dashboard-filters";
import { WorkItemBoardCopyAction } from "./work-item-board-copy-action";
import { workItemBoardCsv } from "./work-item-board-csv";
import { workItemPairPath } from "./work-item-pair";
import { WorkItemBoardCsvAction } from "./work-item-board-csv-action";
import {
  nextWorkItemCardId,
  workItemBoardMoveForKey,
} from "./work-item-board-keyboard";
import { workItemBoardMarkdown } from "./work-item-board-markdown";
import { WorkItemBoardViewLinkAction } from "./work-item-board-view-link-action";
import { WorkItemCardMenu } from "./work-item-card-menu";
import {
  WorkItemCreateAction,
  WorkItemCreateDialog,
} from "./work-item-create-dialog";
import { workItemDuplicateDraft } from "./work-item-duplicate";
import { WorkItemPeek } from "./work-item-peek";
import {
  tenantWorkItemTargetQueryOptions,
  tenantWorkItemsDashboardQueryOptions,
} from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { workItemStoryPath } from "./work-item-story";
import { createWorkItemRoomFilterModel } from "./work-item-room-filter";
import { WorkItemSelectionCopyLinks } from "./work-item-selection-copy";
import {
  createWorkItemDashboardSort,
  DEFAULT_WORK_ITEM_DASHBOARD_SORT,
  sortWorkItems,
  WORK_ITEM_DASHBOARD_SORTS,
  workItemDashboardSortSearch,
  type WorkItemDashboardSort,
} from "./work-item-sort";
import { leadUnmetPromises } from "./work-item-unmet-promise";
import { useWorkItemSelection } from "./use-work-item-selection";

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

/** One column's cards in the order the board shows them. */
interface BoardSection {
  column: DashboardColumn;
  items: TeamHubWorkItem[];
}

const dashboardDateFormatter = dateTimeFormat({
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

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

const sortLabels: Record<WorkItemDashboardSort, string> = {
  newest: "Newest first",
  priority: "Most urgent",
  updated: "Recently updated",
};

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
  // The card menu's Duplicate opens the create dialog on a copy of that Item.
  const [duplicateItem, setDuplicateItem] = useState<TeamHubWorkItem>();
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
  const sort = createWorkItemDashboardSort(searchParams.get("sort"));
  const day = useLocalDay();
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
      matchesWorkItemText(item, filters.text) &&
      roomFilter.matches(item, filters.room) &&
      (filters.assignment !== "unassigned" || item.assignees.length === 0),
  );
  const orderedItems = sortWorkItems(filteredItems, sort);
  const dashboardSearch = workItemDashboardSortSearch(
    workItemDashboardFiltersSearch(filters),
    sort,
  );
  const hasActiveFilters = hasWorkItemDashboardFilters(filters);
  const showFilterBar = items.length > 0 || hasActiveFilters;
  const showClearFilters = hasWorkItemDashboardNarrowingFilters(filters);
  // Empty columns would look like missing data, so any active filter that
  // hides every card says why and offers one way back.
  const filtersHideBoard = hasActiveFilters && filteredItems.length === 0;
  // The columns render these exact lists, so the copied Markdown matches them.
  const boardSections: BoardSection[] = dashboardColumns.map((column) => {
    const columnItems = orderedItems.filter(
      (item) => dashboardColumnFor(item) === column.id,
    );
    return {
      column,
      items:
        column.id === "todo" && sort === DEFAULT_WORK_ITEM_DASHBOARD_SORT
          ? leadUnmetPromises(columnItems, currentActorId, day)
          : columnItems,
    };
  });
  const exportSections = boardSections.map(
    ({ column, items: columnItems }) => ({
      items: columnItems,
      label: column.label,
    }),
  );
  const boardMarkdown = workItemBoardMarkdown({
    filters: activeFilterLabels(filters, roomFilter.options),
    origin: window.location.origin,
    sections: exportSections,
    sortLabel: sortLabels[sort],
    tenantId,
  });
  const boardCsv = workItemBoardCsv({
    origin: window.location.origin,
    roomLabel: roomFilter.originLabel,
    sections: exportSections,
    tenantId,
  });

  function updateFilters(next: WorkItemDashboardFilters) {
    setSearchParams(
      workItemDashboardSortSearch(workItemDashboardFiltersSearch(next), sort),
      { replace: true },
    );
  }

  // A new order is a step the reader can undo, so it pushes a history entry.
  function updateSort(next: WorkItemDashboardSort) {
    setSearchParams(
      workItemDashboardSortSearch(
        workItemDashboardFiltersSearch(filters),
        next,
      ),
    );
  }

  return (
    <main className="work-items-surface flex min-h-0 flex-1 flex-col overflow-hidden bg-app-surface">
      <header className="work-items-header shrink-0 border-b border-app-border px-5 py-3 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl text-foreground">Dashboard</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {filteredItems.length === items.length
                ? itemCount(items.length)
                : `${filteredItems.length} of ${items.length} items`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkItemBoardCsvAction
              csv={boardCsv}
              disabled={!filteredItems.length}
            />
            <WorkItemBoardCopyAction markdown={boardMarkdown} />
            <WorkItemBoardViewLinkAction
              filters={filters}
              sort={sort}
              tenantId={tenantId}
            />
            <WorkItemCreateAction rooms={rooms.items} tenantId={tenantId} />
          </div>
        </div>
        {showFilterBar ? (
          <div
            aria-label="Work Item filters"
            className="mt-3 flex flex-wrap items-center gap-2"
            role="group"
          >
            <label className="select-pill w-52 cursor-text pr-1.5 focus-within:ring-2 focus-within:ring-app-focus">
              <Icon icon={Search01Icon} size={14} />
              <input
                aria-label="Filter by title"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
                onChange={(event) =>
                  updateFilters({ ...filters, text: event.target.value })
                }
                placeholder="Filter by title"
                role="searchbox"
                type="text"
                value={filters.text}
              />
              {filters.text ? (
                <button
                  aria-label="Clear title filter"
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                  onClick={() => updateFilters({ ...filters, text: "" })}
                  type="button"
                >
                  <Icon icon={Cancel01Icon} size={12} />
                </button>
              ) : null}
            </label>
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
                  {WORK_ITEM_DASHBOARD_PRIORITY_LABELS[priority]}
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
            {showClearFilters ? (
              <button
                className="select-pill"
                onClick={() =>
                  updateFilters(clearWorkItemDashboardFilters(filters))
                }
                type="button"
              >
                Clear filters
              </button>
            ) : null}
            <Select
              aria-label="Sort"
              onValueChange={(value) =>
                updateSort(createWorkItemDashboardSort(value))
              }
              value={sort}
              variant="pill"
            >
              {WORK_ITEM_DASHBOARD_SORTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {sortLabels[option]}
                </SelectItem>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      {filtersHideBoard ? (
        <section
          aria-label="No matching items"
          className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center"
        >
          <div>
            <h2 className="text-sm font-semibold text-app-ink">
              No matching items
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filters.text.trim()
                ? "Only Work Item titles are searched. Try adjusting or clearing your filters."
                : "No Work Items match the active filters."}
            </p>
            <Button
              className="mt-4"
              onClick={() =>
                updateFilters(clearWorkItemDashboardFilters(filters))
              }
              size="compact"
              tone="secondary"
            >
              Clear filters
            </Button>
          </div>
        </section>
      ) : items.length || showFilterBar ? (
        <WorkItemBoard
          focusedCardRef={focusedCardRef}
          focusedWorkItemId={focusedWorkItemId}
          onDuplicate={setDuplicateItem}
          onPeek={openPeek}
          originRoomLabel={roomFilter.originLabel}
          search={dashboardSearch}
          sections={boardSections}
          tenantId={tenantId}
        />
      ) : (
        <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center">
          <div>
            <span className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon icon={CheckListIcon} size={16} />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-app-ink">
              No Work Items yet
            </h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Track issues and Agent tasks across your Rooms. Create your first
              issue to get started.
            </p>
            <div className="mt-4 flex justify-center">
              <WorkItemCreateAction rooms={rooms.items} tenantId={tenantId} />
            </div>
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
      {duplicateItem ? (
        <WorkItemCreateDialog
          initial={workItemDuplicateDraft(duplicateItem)}
          key={duplicateItem.id}
          onClose={() => setDuplicateItem(undefined)}
          rooms={rooms.items}
          tenantId={tenantId}
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

/**
 * The board's columns plus the keyboard focus ring. The ring is board state
 * rather than DOM focus, so it survives re-renders, Escape can drop it without
 * moving the page, and typing elsewhere never inherits it.
 */
function WorkItemBoard({
  focusedCardRef,
  focusedWorkItemId,
  onDuplicate,
  onPeek,
  originRoomLabel,
  search,
  sections,
  tenantId,
}: {
  focusedCardRef: RefCallback<HTMLAnchorElement>;
  focusedWorkItemId?: string;
  onDuplicate: (item: TeamHubWorkItem) => void;
  onPeek: (item: TeamHubWorkItem, card: HTMLAnchorElement) => void;
  originRoomLabel: (item: TeamHubWorkItem) => string;
  search: string;
  sections: BoardSection[];
  tenantId: string;
}) {
  const [closedExpanded, setClosedExpanded] = useState(true);
  const [keyboardFocusId, setKeyboardFocusId] = useState<string>();
  // A collapsed column shows no cards, so its Items leave the move order too.
  const shownItems = sections.flatMap(({ column, items }) =>
    column.id === "closed" && !closedExpanded ? [] : items,
  );
  const selection = useWorkItemSelection({ items: shownItems, tenantId });
  const hasSelection = selection.count > 0;
  // Display order and the visible set both come from the cards the board drew.
  const selectedItems = shownItems.filter((item) =>
    selection.isSelected(item.id),
  );
  const orderedIdsKey = shownItems.map((item) => item.id).join("\n");
  const orderedIds = useMemo(
    () => (orderedIdsKey ? orderedIdsKey.split("\n") : []),
    [orderedIdsKey],
  );
  // A filter that hides the marked card leaves no stale ring on another one.
  useEffect(() => {
    setKeyboardFocusId((current) =>
      current !== undefined && !orderedIds.includes(current)
        ? undefined
        : current,
    );
  }, [orderedIds]);
  // The nearest card position, so a move scrolls the column and never the page.
  useLayoutEffect(() => {
    if (keyboardFocusId === undefined) return;
    cardForWorkItem(keyboardFocusId)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [keyboardFocusId]);

  const handleBoardKey = useEffectEvent((event: KeyboardEvent) => {
    const move = workItemBoardMoveForKey(event.key);
    if (move) {
      event.preventDefault();
      const nextId = nextWorkItemCardId(orderedIds, keyboardFocusId, move);
      if (nextId !== undefined) setKeyboardFocusId(nextId);
      return;
    }
    if (event.key === "Escape" && keyboardFocusId !== undefined) {
      event.preventDefault();
      setKeyboardFocusId(undefined);
      return;
    }
    if (event.key !== "Enter" || keyboardFocusId === undefined) return;
    // A link or button keeps its own Enter, so the ring never steals the key
    // from the control the person actually focused.
    if (
      event.target instanceof Element &&
      event.target.closest(
        "a, button, summary, [role='button'], [role='menuitem']",
      )
    ) {
      return;
    }
    const item = shownItems.find(
      (candidate) => candidate.id === keyboardFocusId,
    );
    const card = cardForWorkItem(keyboardFocusId);
    if (!item || !card) return;
    // The marked card, not whichever card happens to hold DOM focus.
    event.preventDefault();
    onPeek(item, card);
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcutKeyEvent(event)) return;
      handleBoardKey(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {shownItems.length > 0 || selection.outcome ? (
        <div
          aria-label="Work Item selection"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-app-border px-4 py-2 text-sm sm:px-5"
          role="group"
        >
          {hasSelection ? (
            <span className="text-app-body">{selection.count} selected</span>
          ) : null}
          {shownItems.length > 0 ? (
            <Button
              disabled={selection.pending}
              onClick={
                selection.allSelected
                  ? selection.deselectAll
                  : selection.selectAll
              }
              size="compact"
              title={
                selection.allSelected
                  ? "Clear the selection"
                  : "Select every card the board shows"
              }
              tone="secondary"
            >
              {selection.allSelected ? "Deselect all" : "Select all"}
            </Button>
          ) : null}
          {shownItems.length > 0 ? (
            <WorkItemSelectionCopyLinks
              disabled={!hasSelection || selection.pending}
              items={selectedItems}
              tenantId={tenantId}
            />
          ) : null}
          {selectedItems.length === 2 ? (
            <Link
              className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={workItemPairPath(
                tenantId,
                selectedItems[0]!.id,
                selectedItems[1]!.id,
              )}
            >
              Read side by side
            </Link>
          ) : null}
          {hasSelection ? (
            <Button
              loading={selection.pending}
              onClick={() => void selection.archive()}
              size="compact"
              tone="secondary"
            >
              Archive
            </Button>
          ) : null}
          {hasSelection ? (
            <Button
              disabled={selection.pending}
              onClick={selection.clear}
              size="compact"
              tone="ghost"
            >
              Clear
            </Button>
          ) : null}
          {selection.outcome ? (
            <p
              className={
                selection.outcome.failed ? "text-app-danger" : "text-app-muted"
              }
              role={selection.outcome.failed ? "alert" : "status"}
            >
              {selection.outcome.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="work-items-board workspace-scrollbar min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-5">
        <div className="grid h-full min-w-[960px] grid-cols-4 gap-3">
          {sections.map(({ column, items }) => (
            <WorkItemColumn
              closedExpanded={closedExpanded}
              column={column}
              focusedCardRef={focusedCardRef}
              focusedWorkItemId={focusedWorkItemId}
              isSelected={selection.isSelected}
              items={items}
              key={column.id}
              keyboardFocusId={keyboardFocusId}
              onDuplicate={onDuplicate}
              onPeek={onPeek}
              onToggleClosed={() => setClosedExpanded((expanded) => !expanded)}
              onToggleSelected={selection.toggle}
              originRoomLabel={originRoomLabel}
              search={search}
              selectionActive={hasSelection}
              tenantId={tenantId}
            />
          ))}
        </div>
      </div>
    </>
  );
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

/** The filters in force, named the way the header names them. */
function activeFilterLabels(
  filters: WorkItemDashboardFilters,
  roomOptions: readonly { id: string; label: string }[],
) {
  const labels: string[] = [];
  if (filters.room) {
    labels.push(
      `Room ${roomOptions.find((option) => option.id === filters.room)?.label ?? filters.room}`,
    );
  }
  if (filters.priority) {
    labels.push(
      `Priority ${WORK_ITEM_DASHBOARD_PRIORITY_LABELS[filters.priority]}`,
    );
  }
  if (filters.assignment !== "all") {
    labels.push(`Assignment ${assignmentLabels[filters.assignment]}`);
  }
  if (filters.execution) {
    labels.push(`Execution ${executionLabels[filters.execution]}`);
  }
  if (filters.text.trim()) labels.push(`Title “${filters.text.trim()}”`);
  if (filters.archived) labels.push("Archived");
  return labels;
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
  closedExpanded,
  column,
  focusedCardRef,
  focusedWorkItemId,
  isSelected,
  items,
  keyboardFocusId,
  onDuplicate,
  onPeek,
  onToggleClosed,
  onToggleSelected,
  originRoomLabel,
  search,
  selectionActive,
  tenantId,
}: {
  closedExpanded: boolean;
  column: DashboardColumn;
  focusedCardRef: RefCallback<HTMLAnchorElement>;
  focusedWorkItemId?: string;
  isSelected: (workItemId: string) => boolean;
  items: TeamHubWorkItem[];
  /** The card the board's keys marked, which scrolls and Enter opens. */
  keyboardFocusId?: string;
  onDuplicate: (item: TeamHubWorkItem) => void;
  onPeek: (item: TeamHubWorkItem, card: HTMLAnchorElement) => void;
  onToggleClosed: () => void;
  onToggleSelected: (workItemId: string) => void;
  originRoomLabel: (item: TeamHubWorkItem) => string;
  search: string;
  /** Whether any card is selected, which keeps every checkbox in view. */
  selectionActive: boolean;
  tenantId: string;
}) {
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
            onClick={onToggleClosed}
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
            <li className="group/card relative" key={item.id}>
              <Link
                aria-current={
                  item.id === focusedWorkItemId ? "location" : undefined
                }
                className="work-item-card block py-2.5 pl-3 pr-9 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                data-keyboard-focus={
                  item.id === keyboardFocusId ? "true" : undefined
                }
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
              <span
                className={cn(
                  "absolute right-2.5 top-9",
                  selectionActive
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 transition-opacity group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                )}
              >
                <input
                  aria-label={`Select ${item.title}`}
                  checked={isSelected(item.id)}
                  className="size-4 cursor-pointer accent-primary"
                  onChange={() => onToggleSelected(item.id)}
                  type="checkbox"
                />
              </span>
              <span className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                <WorkItemCardMenu
                  item={item}
                  onDuplicate={onDuplicate}
                  tenantId={tenantId}
                />
              </span>
              <Link
                className="mt-1 block px-3 text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={workItemStoryPath(tenantId, item.id)}
              >
                What happened
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

/** The local day, replaced when that day ends so an unmet promise can lead. */
function useLocalDay() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(
      () => setNow(new Date()),
      Math.max(0, next.getTime() - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [now]);
  return now;
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
