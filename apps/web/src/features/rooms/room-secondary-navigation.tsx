import { useRoomRenderTiming } from "./room-render-timing";
/* oxlint-disable react-doctor/no-giant-component -- Navigation owns Room grouping, activity state, and the create-Agent flow so these controls share one sidebar lifecycle. */
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  PinIcon,
  Search01Icon,
  SidebarLeftIcon,
  TickDouble02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  lazy,
  type MouseEvent,
  type PointerEvent,
  Suspense,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { jumpPath } from "@/features/jump/jump-path";
import { jumpShortcutLabel } from "@/features/jump/jump-shortcut";
import { searchShortcutLabel } from "@/features/search/search-shortcut";
import { surprisePath } from "./surprise-room";
import { whoIsAwakePath } from "./who-is-awake";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import { myRulesQueryOptions } from "@/features/settings/my-rules-queries";
import { teamHubIdentityQueryOptions } from "./room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { cn } from "@/lib/cn";

import { latestShadowLine } from "./shadow-line";

import { AgentCreateMenu } from "./agent-create-menu";
import {
  awayRecap,
  awayRecapVisible,
  readAwayRecapDismissal,
  writeAwayRecapDismissal,
} from "./away-recap";
import { AwayRecapCard, type AwayRecapCatchUp } from "./away-recap-card";
import { beginCatchUp, readCatchUpWalk } from "./catch-up";
import type {
  TeamHubRoomListItem,
  TeamHubTenant,
} from "@/features/teamhub/teamhub-types";

import { ActorAvatar } from "./members/actor-avatar";
import { useAgentAvatarRecord } from "./members/actor-avatar-image";
import {
  agentAvatarAppearance,
  resolveAgentAvatarKey,
} from "./members/agent-avatar";
import { RoomAvatar } from "./members/room-avatar";
import { spokenRoomFace } from "./members/room-spoken-face";
import { QuietRemindersControl } from "./another-me-quiet-control";
import { useAnotherMeQuiet } from "./another-me-quiet";
import { PocketNoteLauncher } from "./pocket-notes/pocket-note-launcher";
import {
  draftStorageEntries,
  roomsWithDrafts,
  subscribeRoomComposerDrafts,
} from "./room-drafts";
import { WorkingNowStrip } from "./working-now-strip";
import {
  trackRunsYouStarted,
  workingNowRooms,
  type FinishedRun,
  type RunYouStarted,
} from "./working-now";
import { RecordingEntry } from "./voice-control/recording-entry";
import { useNavReorderFlip } from "./use-nav-reorder-flip";
import {
  useWorkingClock,
  workingDuration,
  type WorkingDuration,
} from "./working-duration";

import {
  AgentRowMenu,
  pinnedFirst,
  RoomMentionMenu,
  RoomPinButton,
  useMarkAllRoomsRead,
  useRoomPin,
} from "./room-nav-actions";
import { markAllRoomsReadTargets } from "./room-mark-all-read";
import {
  isRoomMentionMuted,
  isRoomMentionSnoozed,
  useRoomMentionMute,
  useRoomMentionSnooze,
} from "./room-mention-snooze";
import { RoomListCopyMenu } from "./room-list-copy-menu";
import { roomMarkReadCursor } from "./room-mark-read";
import {
  clearRoomSnooze,
  isRoomSnoozed,
  roomSnoozedIds,
  useRoomSnooze,
} from "./room-snooze";
import { splitSnoozedRooms } from "./room-snooze-filter";
import {
  readRoomFilterMode,
  roomFilterRows,
  subscribeRoomUnreadFilter,
  writeRoomFilterMode,
  type RoomFilterMode,
} from "./room-unread-filter";
const QuickCreateLocalAgentDialog = lazy(async () => ({
  default: (await import("./quick-create-local-agent-dialog"))
    .QuickCreateLocalAgentDialog,
}));
const importCreateAgentFromTemplateFlow = () =>
  import("./agent-templates/create-agent-from-template-flow");
const CreateAgentFromTemplateFlow = lazy(async () => ({
  default: (await importCreateAgentFromTemplateFlow())
    .CreateAgentFromTemplateFlow,
}));

/**
 * Warm the template chunk once the browser is idle. It is lazily loaded to stay
 * off the initial JavaScript graph, so without this the very first open waits on
 * a network fetch behind `fallback={null}` and the dialog snaps in; later opens
 * hit the module cache, which is why this only ever showed up once per session.
 */
function usePrefetchTemplateFlow() {
  useEffect(() => {
    // Idle only, with no timer fallback: a fallback fires inside jsdom, which
    // has no requestIdleCallback, and drags this dynamic import into every test
    // that renders the sidebar. Where the API is missing the dialog simply
    // loads on demand as before.
    const idle = globalThis.requestIdleCallback;
    if (!idle) return;
    // A busy Room may never go idle, so the timeout makes the prefetch happen
    // either way; without it the first open still waits on the fetch.
    const handle = idle(() => void importCreateAgentFromTemplateFlow(), {
      timeout: 2000,
    });
    return () => globalThis.cancelIdleCallback?.(handle);
  }, []);
}

/**
 * Room ids whose saved composer holds text. The composer already announces its
 * own saves and clears, so the hint follows them without a query or a timer,
 * and the subscription only changes when the Account or Tenant does.
 */
function useDraftRoomIds(
  accountId: string | undefined,
  tenantId: string,
): Set<string> {
  const [roomIds, setRoomIds] = useState(() =>
    roomsWithDrafts(draftStorageEntries(), accountId, tenantId),
  );
  useEffect(() => {
    const refresh = () =>
      setRoomIds(roomsWithDrafts(draftStorageEntries(), accountId, tenantId));
    refresh();
    return subscribeRoomComposerDrafts(refresh);
  }, [accountId, tenantId]);
  return roomIds;
}

export function RoomSecondaryNavigation({
  accountId,
  activeRoomId,
  actorId,
  anotherMeRoomId,
  navigationStatus,
  onCloseMobile,
  onCollapse,
  onCreateRoom,
  onOpenSearch,
  rooms,
  failedRoomIds = [],
  runningRoomIds = [],
  tenant,
}: {
  /** Scopes the away recap's dismissal to this Account in this Tenant. */
  accountId?: string;
  activeRoomId?: string;
  /** The signed-in actor in this tenant, so a run they started can be told apart. */
  actorId?: string;
  anotherMeRoomId?: string;
  navigationStatus?: ReactNode;
  onCloseMobile: () => void;
  /**
   * Given on the desktop app: the header carries the module title and a
   * collapse control, and Search moves into the list.
   */
  onCollapse?: () => void;
  onCreateRoom: () => void;
  onOpenSearch?: () => void;
  rooms: TeamHubRoomListItem[];
  failedRoomIds?: readonly string[];
  runningRoomIds?: readonly string[];
  tenant: TeamHubTenant;
}) {
  usePrefetchTemplateFlow();
  const { client } = useTeamHubRuntime();
  const rules = useQuery({
    ...myRulesQueryOptions(client, tenant.id),
    enabled: Boolean(anotherMeRoomId) && typeof client.api?.GET === "function",
    staleTime: 60_000,
  });
  const shadowLine = rules.data
    ? latestShadowLine(rules.data.divergences, Date.now())
    : undefined;
  const [localAgentOpen, setLocalAgentOpen] = useState(false);
  const [templateAgentOpen, setTemplateAgentOpen] = useState(false);
  const [filterMode, setFilterModeState] = useState<RoomFilterMode>(() =>
    readRoomFilterMode(accountId),
  );
  // Clearing this browser's preferences elsewhere returns the filter to All.
  useEffect(() => {
    const refresh = () => setFilterModeState(readRoomFilterMode(accountId));
    refresh();
    return subscribeRoomUnreadFilter(refresh);
  }, [accountId]);
  function setFilterMode(next: RoomFilterMode) {
    setFilterModeState(next);
    writeRoomFilterMode(accountId, next);
  }
  const mentionSnooze = useRoomMentionSnooze(accountId);
  const mentionMute = useRoomMentionMute(accountId);
  const roomSnooze = useRoomSnooze(accountId);
  // Rows judge expiry against this reading, so a snooze that ends passes on
  // the next render without a cleanup step.
  const now = new Date();
  const runningRooms = new Set(runningRoomIds);
  const [runsYouStarted, setRunsYouStarted] = useState<{
    finished: FinishedRun[];
    started: RunYouStarted[];
  }>({ finished: [], started: [] });
  useEffect(() => {
    setRunsYouStarted((current) => {
      const next = trackRunsYouStarted({
        activeRoomId,
        actorId,
        anotherMeRoomId,
        failedRoomIds,
        finished: current.finished,
        rooms,
        runningRoomIds,
        started: current.started,
      });
      return sameRunTrack(current, next) ? current : next;
    });
  }, [
    activeRoomId,
    actorId,
    anotherMeRoomId,
    failedRoomIds,
    rooms,
    runningRoomIds,
  ]);
  const failedRooms = new Set(failedRoomIds);
  const draftRoomIds = useDraftRoomIds(accountId, tenant.id);
  const workingClock = useWorkingClock(runningRoomIds);
  const durationFor = (roomId: string) =>
    workingDuration(workingClock.since[roomId], workingClock.now);
  const catchUpCount = beginCatchUp(rooms).rooms.length;
  const storedCatchUp = accountId
    ? readCatchUpWalk(accountId, tenant.id)
    : undefined;
  const remainingCatchUpCount =
    storedCatchUp && storedCatchUp.index < storedCatchUp.rooms.length
      ? storedCatchUp.rooms.length - storedCatchUp.index
      : 0;
  const recap = useMemo(
    () => awayRecap(rooms, activeRoomId),
    [activeRoomId, rooms],
  );
  const recapScopeKey = `${accountId}:${tenant.id}`;
  const [recapDismissal, setRecapDismissal] = useState<{
    at: string | null;
    scopeKey: string;
  }>(() => ({
    at: readAwayRecapDismissal(accountId, tenant.id),
    scopeKey: recapScopeKey,
  }));
  const awayRecapDismissedAt =
    recapDismissal.scopeKey === recapScopeKey
      ? recapDismissal.at
      : readAwayRecapDismissal(accountId, tenant.id);
  const showingAwayRecap =
    !navigationStatus && awayRecapVisible(recap, awayRecapDismissedAt);
  function dismissAwayRecap(cutoff: string) {
    writeAwayRecapDismissal(accountId, tenant.id, cutoff);
    setRecapDismissal({ at: cutoff, scopeKey: recapScopeKey });
  }
  const catchUpAction: AwayRecapCatchUp | undefined =
    catchUpCount > 0 || remainingCatchUpCount > 0
      ? {
          ariaLabel:
            catchUpCount > 0
              ? `Catch up, ${catchUpCount} ${catchUpCount === 1 ? "chat" : "chats"}`
              : `Resume catch up, ${remainingCatchUpCount} ${remainingCatchUpCount === 1 ? "chat" : "chats"} left`,
          count: catchUpCount > 0 ? catchUpCount : remainingCatchUpCount,
          label: catchUpCount > 0 ? "Catch up" : "Resume catch up",
          onClick: onCloseMobile,
        }
      : undefined;
  const visibleRoomIds = new Set(
    rooms.flatMap((room) =>
      room.parent_room_id ? [room.parent_room_id] : [room.id],
    ),
  );
  const anotherMeRoom = rooms.find((room) => room.id === anotherMeRoomId);
  const chats = pinnedFirst(
    rooms
      .filter(
        (room) =>
          room.kind === "room" ||
          (room.kind === "direct" &&
            room.id !== anotherMeRoomId &&
            room.direct_peer?.kind === "agent"),
      )
      .sort(
        (left, right) =>
          Date.parse(right.latest_message?.created_at ?? right.created_at) -
          Date.parse(left.latest_message?.created_at ?? left.created_at),
      ),
  );
  const roomPin = useRoomPin(tenant.id);
  const markAllRead = useMarkAllRoomsRead(tenant.id);
  // Every chat row can acknowledge a cursor, including a filtered-out or
  // snoozed one: the action clears the Room, not just what the list shows.
  const unreadRoomCount = markAllRoomsReadTargets(chats).length;
  function togglePin(room: TeamHubRoomListItem) {
    roomPin.mutate({ pinned: !room.pinned_at, roomId: room.id });
  }
  // A snoozed row's Unpin writes through the same pin mutation as the row
  // button, so only this attempt's failure needs its own report.
  const [unpinFailed, setUnpinFailed] = useState(false);
  function unpinSnoozedRoom(roomId: string) {
    setUnpinFailed(false);
    roomPin.mutate(
      { pinned: false, roomId },
      {
        onError: () => setUnpinFailed(true),
        onSuccess: () => setUnpinFailed(false),
      },
    );
  }
  const visibleAnotherMeRoom =
    anotherMeRoom && visibleRoomIds.has(anotherMeRoom.id)
      ? anotherMeRoom
      : undefined;
  const visibleChats = chats.filter((room) => visibleRoomIds.has(room.id));
  const listedChats = roomFilterRows(visibleChats, activeRoomId, filterMode);
  // A snoozed Room leaves the list until its instant passes; the active Room
  // stays, so opening one never hides it. Hidden rows are still the same Rooms
  // with the same unread counts, listed behind the snoozed line.
  const { hidden: snoozedChats, visible: shownChats } = splitSnoozedRooms(
    listedChats,
    roomSnoozedIds(roomSnooze, now),
    activeRoomId,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const reorderKey = shownChats
    .map((room) => `${room.id}:${room.pinned_at ? 1 : 0}`)
    .join("|");
  useNavReorderFlip(listRef, reorderKey);
  const navigate = useNavigate();
  function completeNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    roomId: string,
  ) {
    onCloseMobile();
    // A pointer click into another Room means "write here"; keyboard
    // activation, touch, and modified clicks keep the default navigation.
    if (
      event.detail === 0 ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      roomId === activeRoomId ||
      window.matchMedia("(pointer: coarse)").matches
    )
      return;
    event.preventDefault();
    void navigate(`/t/${tenant.id}/rooms/${roomId}/chat`, {
      state: { focusComposer: true },
    });
  }

  const searchButton = (
    <button
      aria-keyshortcuts="Control+k Meta+k"
      aria-label="Search"
      className="room-secondary-navigation-search flex h-7 w-full min-w-0 shrink items-center justify-between gap-1.5 rounded-lg bg-card px-2.5 text-xs text-muted-foreground shadow-outline transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11"
      onClick={() => {
        onOpenSearch?.();
        onCloseMobile();
      }}
      title={`Search (${searchShortcutLabel()})`}
      type="button"
    >
      <span className="truncate">Search chats</span>
      <Icon className="shrink-0" icon={Search01Icon} size={14} />
    </button>
  );

  return (
    <nav
      aria-label="Room navigation"
      className="app-secondary-navigation relative flex w-[var(--sidebar-width)] min-w-0 flex-col bg-card"
    >
      {onCollapse ? (
        // Shares the 57px height of the chat header so both titles sit on
        // one line; a hairline fades in under it once the list scrolls.
        <header
          aria-label="Message actions"
          className="app-secondary-navigation-header room-secondary-navigation-header relative z-40 flex h-(--app-header-height) shrink-0 items-center justify-between gap-2 pl-px pr-4"
          role="toolbar"
        >
          <span className="room-secondary-navigation-title truncate">
            Messages
          </span>
          <div className="flex items-center gap-0.5">
            {accountId ? (
              <QuietRemindersControl accountId={accountId} variant="toolbar" />
            ) : null}
            <PocketNoteLauncher
              anotherMeRoomId={anotherMeRoomId}
              tenantId={tenant.id}
            />
            <RecordingEntry
              anotherMeRoomId={anotherMeRoomId}
              tenantId={tenant.id}
            />
            <RoomListCopyMenu rooms={shownChats} tenantId={tenant.id} />
          </div>
          <button
            aria-label="Hide Chat list"
            className="room-secondary-navigation-collapse flex size-7 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink"
            onClick={onCollapse}
            title="Hide Chat list"
            type="button"
          >
            <Icon icon={SidebarLeftIcon} />
          </button>
        </header>
      ) : (
        <div
          className="xs-nav-quick flex shrink-0 items-center gap-1.5 pl-0 pr-1.5 pt-3"
          aria-label="Quick access"
        >
          {accountId ? (
            <QuietRemindersControl accountId={accountId} variant="toolbar" />
          ) : null}
          <PocketNoteLauncher
            anotherMeRoomId={anotherMeRoomId}
            tenantId={tenant.id}
          />
          <RecordingEntry
            anotherMeRoomId={anotherMeRoomId}
            tenantId={tenant.id}
          />
          <RoomListCopyMenu rooms={shownChats} tenantId={tenant.id} />
          <button
            aria-keyshortcuts="Control+k Meta+k"
            aria-label="Search"
            title={`Search (${searchShortcutLabel()})`}
            className="xs-nav-search"
            onClick={() => {
              onOpenSearch?.();
              onCloseMobile();
            }}
            type="button"
          >
            <Icon icon={Search01Icon} size={16} />
          </button>
        </div>
      )}

      {localAgentOpen ? (
        <Suspense fallback={null}>
          <QuickCreateLocalAgentDialog
            onClose={() => setLocalAgentOpen(false)}
            tenantId={tenant.id}
          />
        </Suspense>
      ) : null}
      {templateAgentOpen ? (
        <Suspense fallback={null}>
          <CreateAgentFromTemplateFlow
            onClose={() => {
              setTemplateAgentOpen(false);
              onCloseMobile();
            }}
            tenantId={tenant.id}
          />
        </Suspense>
      ) : null}

      <div
        data-voice-scroll="sidebar"
        className="room-secondary-navigation-list workspace-scrollbar flex-1 space-y-3 overflow-y-auto pb-1 pt-2"
        ref={listRef}
      >
        <div
          aria-label="Room shortcuts"
          className="mx-2 flex items-center gap-1"
          role="group"
        >
          <Link
            aria-keyshortcuts="Control+j Meta+j"
            aria-label="Jump anywhere"
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCloseMobile}
            title={`Jump anywhere (${jumpShortcutLabel()})`}
            to={jumpPath(tenant.id)}
          >
            <span className="truncate">Jump</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-2xs text-app-subtle"
            >
              {jumpShortcutLabel()}
            </span>
          </Link>
          <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border/60" />
          <Link
            aria-label="Who is awake"
            className="flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCloseMobile}
            title="Who is awake"
            to={whoIsAwakePath(tenant.id)}
          >
            <span className="truncate">Awake</span>
          </Link>
          <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border/60" />
          <Link
            aria-label="Surprise me"
            className="flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCloseMobile}
            title="Surprise me"
            to={surprisePath(tenant.id)}
          >
            <span className="truncate">Surprise</span>
          </Link>
        </div>
        {onCollapse ? searchButton : null}
        {!showingAwayRecap && catchUpAction ? (
          <Link
            aria-label={catchUpAction.ariaLabel}
            className="mx-2 flex items-center justify-between rounded-lg bg-app-hover px-2.5 py-2 text-sm text-app-ink hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={catchUpAction.onClick}
            to={`/t/${tenant.id}/rooms/catch-up`}
          >
            {catchUpAction.label}
            <span className="text-xs text-app-muted">
              {catchUpAction.count}
            </span>
          </Link>
        ) : null}
        <WorkingNowStrip
          finished={runsYouStarted.finished}
          onNavigate={onCloseMobile}
          rooms={workingNowRooms(rooms, runningRoomIds)}
          tenantId={tenant.id}
        />
        {/* While the list loads only its skeleton shows; the card and list
            land together once everything has settled. */}
        {navigationStatus ?? (
          <>
            <AwayRecapCard
              accountId={accountId}
              activeRoomId={activeRoomId}
              catchUp={catchUpAction}
              dismissedAt={awayRecapDismissedAt}
              key={recapScopeKey}
              onDismiss={dismissAwayRecap}
              onNavigate={completeNavigation}
              rooms={rooms}
              tenantId={tenant.id}
            />
            {visibleAnotherMeRoom ? (
              <AnotherMeCard
                accountId={accountId}
                active={visibleAnotherMeRoom.id === activeRoomId}
                duration={durationFor(visibleAnotherMeRoom.id)}
                failed={failedRooms.has(visibleAnotherMeRoom.id)}
                shadowLine={shadowLine}
                onNavigate={(event) =>
                  completeNavigation(event, visibleAnotherMeRoom.id)
                }
                room={visibleAnotherMeRoom}
                tenantId={tenant.id}
                working={runningRooms.has(visibleAnotherMeRoom.id)}
              />
            ) : null}
            <NavSection
              action={
                <>
                  <Button
                    aria-label="Mark all Rooms as read"
                    className="border-0 text-app-muted"
                    disabled={unreadRoomCount === 0}
                    loading={markAllRead.running}
                    onClick={() => void markAllRead.markAll(chats)}
                    size="compactIcon"
                    title="Mark all as read"
                    tone="ghost"
                  >
                    <Icon icon={TickDouble02Icon} size={16} />
                  </Button>
                  <AgentCreateMenu
                    onCreateFromTemplate={() => setTemplateAgentOpen(true)}
                    onCreateRoom={onCreateRoom}
                    onCreateAgent={() => {
                      setLocalAgentOpen(true);
                      onCloseMobile();
                    }}
                  />
                </>
              }
              title="Messages"
            >
              {markAllRead.running && markAllRead.progress ? (
                <p className="px-2 text-xs text-app-muted" role="status">
                  Marking {markAllRead.progress.completed} of{" "}
                  {markAllRead.progress.total}…
                </p>
              ) : markAllRead.report ? (
                <p
                  className={`px-2 text-xs ${markAllRead.report.failed ? "text-app-danger" : "text-app-muted"}`}
                  role={markAllRead.report.failed ? "alert" : "status"}
                >
                  {markAllRead.report.message}
                </p>
              ) : null}
              <RoomFilterChoice mode={filterMode} onChange={setFilterMode} />
              {filterMode !== "all" && shownChats.length === 0 ? (
                <FilterEmptyState
                  mode={filterMode}
                  onShowAll={() => setFilterMode("all")}
                />
              ) : null}
              {shownChats.map((room) => {
                if (room.kind === "room") {
                  const muted = isRoomMentionMuted(mentionMute, room.id);
                  const snoozed = isRoomMentionSnoozed(
                    mentionSnooze,
                    room.id,
                    now,
                  );
                  return (
                    <NavRow
                      actions={
                        <>
                          <RoomPinButton
                            name={room.name}
                            onToggle={() => togglePin(room)}
                            pinned={Boolean(room.pinned_at)}
                          />
                          <RoomMentionMenu
                            accountId={accountId}
                            markReadThrough={roomMarkReadCursor(room)}
                            muted={muted}
                            name={room.name}
                            roomId={room.id}
                            roomSnoozed={isRoomSnoozed(
                              roomSnooze,
                              room.id,
                              now,
                            )}
                            snoozed={snoozed}
                            tenantId={tenant.id}
                          />
                        </>
                      }
                      active={room.id === activeRoomId}
                      fade="64px"
                      key={room.id}
                    >
                      <Link
                        aria-current={
                          room.id === activeRoomId ? "page" : undefined
                        }
                        aria-label={room.name}
                        className={roomNavClass()}
                        onClick={(event) => completeNavigation(event, room.id)}
                        to={`/t/${tenant.id}/rooms/${room.id}/chat`}
                      >
                        <RoomAvatar
                          members={spokenRoomFace(
                            room.member_preview ?? [],
                            room.latest_message?.author,
                          )}
                        />
                        <span className="min-w-0 flex-1 px-1">
                          <RoomRowTitle
                            draftName={
                              draftRoomIds.has(room.id) ? room.name : undefined
                            }
                            muted={muted}
                            pinned={Boolean(room.pinned_at)}
                            snoozed={snoozed}
                          >
                            {room.name}
                          </RoomRowTitle>
                          <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
                            {room.latest_message
                              ? markdownPlainText(
                                  room.latest_message.raw_message,
                                )
                              : (room.description ?? "No messages yet")}
                          </span>
                        </span>
                        <RoomRowStatus
                          duration={durationFor(room.id)}
                          failed={failedRooms.has(room.id)}
                          room={room}
                          working={runningRooms.has(room.id)}
                        />
                      </Link>
                    </NavRow>
                  );
                }
                const name = room.direct_peer!.display_name;
                return (
                  <NavRow
                    actions={
                      <>
                        <RoomPinButton
                          name={name}
                          onToggle={() => togglePin(room)}
                          pinned={Boolean(room.pinned_at)}
                        />
                        <AgentRowMenu
                          agentId={
                            room.direct_peer_active === false
                              ? undefined
                              : room.direct_peer?.id
                          }
                          markReadThrough={roomMarkReadCursor(room)}
                          name={name}
                          onTogglePin={() => togglePin(room)}
                          pinned={Boolean(room.pinned_at)}
                          roomId={room.id}
                          tenantId={tenant.id}
                        />
                      </>
                    }
                    active={room.id === activeRoomId}
                    fade="64px"
                    key={room.id}
                  >
                    <DirectRoomLink
                      active={room.id === activeRoomId}
                      draftName={draftRoomIds.has(room.id) ? name : undefined}
                      duration={durationFor(room.id)}
                      onNavigate={(event) => completeNavigation(event, room.id)}
                      room={room}
                      failed={failedRooms.has(room.id)}
                      working={runningRooms.has(room.id)}
                      tenantId={tenant.id}
                    />
                  </NavRow>
                );
              })}
              <SnoozedRoomsLine
                onBringBack={(roomId) =>
                  clearRoomSnooze(accountId, roomId, new Date())
                }
                onUnpin={unpinSnoozedRoom}
                rooms={snoozedChats}
                unpinFailed={unpinFailed}
              />
            </NavSection>
          </>
        )}
      </div>
    </nav>
  );
}

const filterChoices: Array<{
  label: string;
  mode: RoomFilterMode;
  title: string;
}> = [
  { label: "All", mode: "all", title: "Show all Rooms" },
  { label: "Unread", mode: "unread", title: "Show only unread Rooms" },
  {
    label: "Mentions",
    mode: "mentions",
    title: "Show only Rooms with unread mentions",
  },
];

/**
 * The three choices read as pressed toggles rather than commands: each announces
 * its state and its title names what pressing it does, and pressing the chosen
 * filter again returns to every Room.
 */
function RoomFilterChoice({
  mode,
  onChange,
}: {
  mode: RoomFilterMode;
  onChange: (mode: RoomFilterMode) => void;
}) {
  return (
    <div
      aria-label="Room filter"
      className="mx-2 mb-1 flex items-center gap-0.5 rounded-lg bg-card p-0.5 shadow-outline"
      role="group"
    >
      {filterChoices.map((choice) => {
        const active = choice.mode === mode;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-md px-1.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            key={choice.mode}
            onClick={() =>
              onChange(active && choice.mode !== "all" ? "all" : choice.mode)
            }
            title={active ? "Show all Rooms" : choice.title}
            type="button"
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterEmptyState({
  mode,
  onShowAll,
}: {
  mode: Exclude<RoomFilterMode, "all">;
  onShowAll: () => void;
}) {
  return (
    <div className="rounded-lg px-2 py-3">
      <p className="text-xs leading-4 text-muted-foreground">
        {mode === "unread" ? "No unread Rooms" : "No unread mentions"}
      </p>
      <button
        className="mt-1 text-xs font-medium text-foreground underline underline-offset-2 transition-colors hover:text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onShowAll}
        type="button"
      >
        Show all Rooms
      </button>
    </div>
  );
}

/** The list's one quiet line for snoozed Rooms, collapsed until asked. */
function SnoozedRoomsLine({
  onBringBack,
  onUnpin,
  rooms,
  unpinFailed,
}: {
  onBringBack: (roomId: string) => void;
  onUnpin: (roomId: string) => void;
  rooms: TeamHubRoomListItem[];
  unpinFailed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rooms.length === 0) return null;
  return (
    <div className="pt-0.5">
      <button
        aria-expanded={expanded}
        className="flex min-h-7 w-full items-center gap-1 rounded-md px-2 text-left text-xs leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon
          className={`size-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          icon={ArrowDown01Icon}
          size={14}
        />
        <span className="truncate">
          {rooms.length} snoozed Room{rooms.length === 1 ? "" : "s"}
        </span>
      </button>
      {expanded ? (
        <>
          <ul className="mt-0.5 space-y-0.5 pr-2 pb-1 pl-6">
            {rooms.map((room) => (
              <li
                className="flex items-center gap-2 text-xs leading-4 text-muted-foreground"
                key={room.id}
              >
                <span className="min-w-0 flex-1 truncate">{room.name}</span>
                {room.pinned_at ? <RoomPinnedMarker /> : null}
                {room.pinned_at ? (
                  // Pinning is the only thing this removes; the Room stays
                  // snoozed, and Bring back never touches the pin.
                  <button
                    aria-label={`Unpin ${room.name}`}
                    className="shrink-0 rounded-sm font-medium text-foreground underline underline-offset-2 transition-colors hover:text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onUnpin(room.id)}
                    type="button"
                  >
                    Unpin
                  </button>
                ) : null}
                <button
                  aria-label={`Bring back ${room.name}`}
                  className="shrink-0 rounded-sm font-medium text-foreground underline underline-offset-2 transition-colors hover:text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onBringBack(room.id)}
                  type="button"
                >
                  Bring back
                </button>
              </li>
            ))}
          </ul>
          {unpinFailed ? (
            <p
              className="px-2 pb-1 text-xs leading-4 text-app-danger"
              role="alert"
            >
              Could not unpin the Room.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NavSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="space-y-1">
      <div
        className={`flex h-7 items-center gap-1 rounded-lg pl-2 ${action ? "pr-0" : "pr-2"}`}
      >
        <h2 className="min-w-0 flex-1">
          <button
            aria-expanded={!collapsed}
            className="flex h-7 w-full min-w-0 items-center gap-1 text-left text-sm leading-[18px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            onClick={() => setCollapsed((value) => !value)}
            type="button"
          >
            <Icon
              className={`size-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
              icon={ArrowDown01Icon}
              size={14}
            />
            <span className="truncate">{title}</span>
          </button>
        </h2>
        {action ? (
          <div className="relative flex shrink-0 items-center gap-1">
            {action}
          </div>
        ) : null}
      </div>
      {collapsed ? null : <div className="space-y-1">{children}</div>}
    </section>
  );
}

function roomNavClass() {
  return "workspace-nav-row flex min-h-14 items-center gap-2 rounded-lg px-2 py-2 text-foreground";
}

/**
 * The row, not its link, carries the tint, so the title fading out beneath the
 * revealed actions never fades the tint with it.
 */
function NavRow({
  actions,
  active,
  children,
  fade = "36px",
}: {
  actions?: ReactNode;
  active: boolean;
  children: ReactNode;
  fade?: string;
}) {
  return (
    <div
      className={`group rounded-lg ${
        active ? "bg-muted" : "transition-colors duration-300 hover:bg-muted/70"
      }`}
      style={{ "--row-reveal-fade": fade } as CSSProperties}
    >
      {children}
      {actions ? (
        <div className="row-reveal-action flex items-center gap-0.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** The same marker on a Room row and on its snoozed row. */
function RoomPinnedMarker() {
  return (
    <span
      aria-label="Pinned"
      className="room-pin-badge town-pill-pop ml-0.5 flex shrink-0 text-muted-foreground"
      role="img"
    >
      <Icon icon={PinIcon} size={12} />
    </span>
  );
}

function RoomRowTitle({
  children,
  draftName,
  muted = false,
  pinned,
  snoozed = false,
}: {
  children: ReactNode;
  /** The Room's name while it holds an unsent draft. */
  draftName?: string;
  muted?: boolean;
  pinned: boolean;
  snoozed?: boolean;
}) {
  // Mute and snooze both quiet the same notifications, so one hint says which.
  const quietHint = muted ? "Muted" : snoozed ? "Snoozed" : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm leading-[18px] font-medium text-foreground">
      <span className="min-w-0 truncate">{children}</span>
      {draftName ? (
        <span
          aria-label={`Draft in ${draftName}`}
          className="ml-0.5 flex shrink-0 items-center rounded-full bg-muted px-1.5 text-2xs leading-4 font-medium text-muted-foreground"
          role="img"
        >
          Draft
        </span>
      ) : null}
      {pinned ? <RoomPinnedMarker /> : null}
      {quietHint ? (
        <span
          className="shrink-0 text-2xs font-medium leading-4 text-muted-foreground"
          title={`Mention notifications are ${quietHint.toLowerCase()}`}
        >
          {quietHint}
        </span>
      ) : null}
    </span>
  );
}

function DirectRoomLink({
  active,
  draftName,
  duration,
  failed,
  working,
  onNavigate,
  room,
  tenantId,
}: {
  active: boolean;
  draftName?: string;
  duration?: WorkingDuration;
  failed?: boolean;
  working: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  room: TeamHubRoomListItem;
  tenantId: string;
}) {
  const peer = room.direct_peer!;
  const displayName = peer.display_name;
  const inactive = room.direct_peer_active === false;
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={`${displayName}${inactive ? ", Deleted" : ""}`}
      className={roomNavClass()}
      onClick={onNavigate}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      to={`/t/${tenantId}/rooms/${room.id}/chat`}
    >
      <ActorAvatar
        actorId={peer.id}
        animate={!inactive && (hovered || working)}
        kind={peer.kind}
        name={displayName}
        size="nav"
      />
      <span className="min-w-0 flex-1 px-1">
        <RoomRowTitle draftName={draftName} pinned={Boolean(room.pinned_at)}>
          {displayName}
        </RoomRowTitle>
        <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
          {inactive
            ? "Deleted"
            : room.latest_message
              ? markdownPlainText(room.latest_message.raw_message)
              : "No messages yet"}
        </span>
      </span>
      <RoomRowStatus
        duration={duration}
        failed={failed}
        room={room}
        working={working}
      />
    </Link>
  );
}

function RoomAttentionBadge({ room }: { room: TeamHubRoomListItem }) {
  if (room.unread_message_count === 0 && room.unread_mention_count === 0) {
    return null;
  }

  const mentions = room.unread_mention_count > 0;
  const count = mentions
    ? room.unread_mention_count
    : room.unread_message_count;
  const label = mentions
    ? `${count} unread mention${count === 1 ? "" : "s"}`
    : `${count} unread message${count === 1 ? "" : "s"}`;

  return (
    <span
      aria-label={label}
      className="town-pill-pop inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-(--app-unread) px-1 text-2xs leading-none font-medium text-(--app-unread-foreground)"
      title={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Another Me is pinned above the lists as the Human's own card. Its actions
 * live in the toolbar above the card.
 * The card takes its colour from the Agent's avatar background: a glow of it
 * follows the pointer, and the open card fills with it.
 */
function AnotherMeCard({
  accountId,
  active,
  duration,
  failed,
  onNavigate,
  room,
  shadowLine,
  tenantId,
  working,
}: {
  accountId?: string;
  active: boolean;
  duration?: WorkingDuration;
  failed: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  room: TeamHubRoomListItem;
  shadowLine?: string;
  tenantId: string;
  working: boolean;
}) {
  const name = room.direct_peer?.display_name ?? "Another Me";
  const { client } = useTeamHubRuntime();
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const human = identity.data?.actors.find(
    (actor) => actor.tenant_id === tenantId,
  );
  const wornFace =
    active && human
      ? { actorId: human.id, name: human.display_name }
      : undefined;
  const quiet = useAnotherMeQuiet(accountId);
  const agentRecord = useAgentAvatarRecord(room.direct_peer?.id);
  const brand = agentAvatarAppearance(
    resolveAgentAvatarKey({
      actorId: room.direct_peer?.id,
      name,
      storedKey: agentRecord?.avatarKey,
    }),
  ).color;
  // Avatar backgrounds are user-selectable, including white and pale figures.
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel =
      parseInt(brand.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return (
      sum +
      weight *
        (channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
  const darkText = luminance > 0.179;
  // Dark text is the ink #1a1a16, whose relative luminance is about 0.0097.
  const contrast = darkText
    ? (luminance + 0.05) / 0.0597
    : 1.05 / (luminance + 0.05);
  const [hovered, setHovered] = useState(false);
  const tiltFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(tiltFrame.current), []);
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    cancelAnimationFrame(tiltFrame.current);
    tiltFrame.current = requestAnimationFrame(() => {
      card.style.setProperty(
        "--am-tilt-x",
        `${((0.5 - y) * 18).toFixed(2)}deg`,
      );
      card.style.setProperty(
        "--am-tilt-y",
        `${((x - 0.5) * 16).toFixed(2)}deg`,
      );
      card.style.setProperty("--am-glow-x", `${x * 100}%`);
      card.style.setProperty("--am-glow-y", `${y * 100}%`);
    });
  }
  function settle(event: PointerEvent<HTMLDivElement>) {
    cancelAnimationFrame(tiltFrame.current);
    for (const property of [
      "--am-tilt-x",
      "--am-tilt-y",
      "--am-glow-x",
      "--am-glow-y",
    ]) {
      event.currentTarget.style.removeProperty(property);
    }
  }
  return (
    <div
      className="another-me-card"
      data-active={active ? "true" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        setHovered(false);
        settle(event);
      }}
      onPointerMove={tilt}
      style={
        {
          "--am-brand": brand,
          "--am-text": darkText ? "var(--app-ink)" : "var(--app-surface)",
          "--am-sub-opacity": contrast >= 7 ? 0.82 : 1,
        } as CSSProperties
      }
    >
      <Link
        aria-current={active ? "page" : undefined}
        aria-label={`${name} chat`}
        className="workspace-nav-row another-me-card-link flex text-app-ink"
        onClick={onNavigate}
        to={`/t/${tenantId}/rooms/${room.id}/chat`}
      >
        <span className="another-me-card-avatar shrink-0">
          <ActorAvatar
            actorId={room.direct_peer?.id}
            animate={hovered || working}
            asHuman={wornFace}
            kind="agent"
            name={name}
            size="card"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="another-me-card-title block truncate text-sm leading-[18px] font-medium text-app-ink">
            {name}
          </span>
          <span className="another-me-card-sub mt-0.5 block truncate text-xs leading-4 text-app-muted">
            {quiet.label ??
              (room.latest_message
                ? markdownPlainText(room.latest_message.raw_message)
                : "Your personal agent")}
          </span>
        </span>
        <RoomRowStatus
          duration={duration}
          failed={failed}
          room={room}
          working={working}
        />
      </Link>
      {shadowLine ? (
        <Link
          className="mt-1 block truncate px-1 text-xs text-app-muted hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${tenantId}/settings/my-rules`}
        >
          {shadowLine}
        </Link>
      ) : null}
    </div>
  );
}

function RoomRowStatus({
  duration,
  failed = false,
  room,
  working,
}: {
  duration?: WorkingDuration;
  failed?: boolean;
  room: TeamHubRoomListItem;
  working: boolean;
}) {
  useRoomRenderTiming("room_list", {
    roomId: room.id,
    result: working ? "working" : "stopped",
  });
  const hasUnread =
    room.unread_message_count > 0 || room.unread_mention_count > 0;
  const hasActivity = working || failed;
  if (!hasUnread && !hasActivity) return null;
  return (
    <span className="row-reveal-hide ml-auto flex shrink-0 items-center gap-1.5">
      {hasUnread ? <RoomAttentionBadge room={room} /> : null}
      {hasActivity ? (
        <span className="flex shrink-0 items-center gap-1">
          {working && duration ? (
            <span
              aria-hidden="true"
              className="text-2xs tabular-nums text-app-muted"
            >
              {duration.short}
            </span>
          ) : null}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {working ? (
              <span
                aria-label={duration?.speech ?? "Agent working"}
                className="flex text-app-muted"
                role="img"
                title={duration?.speech ?? "Agent working"}
              >
                <Spinner size={14} />
              </span>
            ) : (
              <span
                aria-label="Last run failed"
                className="flex text-app-danger"
                role="img"
              >
                <Icon icon={AlertCircleIcon} size={14} />
              </span>
            )}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function sameRunTrack(
  current: { finished: FinishedRun[]; started: RunYouStarted[] },
  next: { finished: FinishedRun[]; started: RunYouStarted[] },
) {
  if (
    current.started.length !== next.started.length ||
    current.finished.length !== next.finished.length
  ) {
    return false;
  }
  return (
    current.started.every(
      (item, index) =>
        item.roomId === next.started[index]?.roomId &&
        item.messageId === next.started[index]?.messageId,
    ) &&
    current.finished.every(
      (item, index) =>
        item.roomId === next.finished[index]?.roomId &&
        item.messageId === next.finished[index]?.messageId &&
        item.reply === next.finished[index]?.reply,
    )
  );
}
