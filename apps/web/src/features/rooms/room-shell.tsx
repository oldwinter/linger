import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useNavigation,
  useParams,
} from "react-router";

import { DesktopBarSlot } from "@/app/desktop-frame";
import { isDesktopShell } from "@/app/desktop-shell";
import { AccountMenu } from "@/features/auth/account-menu";
import { authMessages } from "@/features/auth/auth.messages";
import { useLogout } from "@/features/auth/use-logout";

import { Button } from "@/components/ui/button";
import { useCarriedMeeting } from "@/features/memory/meeting-carry";
import { useOpenMeetingAtStart } from "@/features/memory/use-open-meeting-at-start";
import { jumpPath } from "@/features/jump/jump-path";
import { useJumpShortcut } from "@/features/jump/jump-shortcut";
import type {
  RoomShellOutletContext,
  SearchRoomScope,
} from "@/features/search/room-search-scope";
import { useGlobalSearchShortcut } from "@/features/search/search-shortcut";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";
import type {
  TeamHubCurrentIdentity,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";

import { ActorAvatarImageProvider } from "./members/actor-avatar-image";
import {
  MobileNavigationButton,
  OpenMobileNavigationContext,
} from "./mobile-navigation";
import { routeLayoutKey } from "./route-layout-key";
import { VoiceControlProvider } from "./voice-control/voice-backend-provider";
import { useOptionalVoiceControl } from "./voice-control/voice-control-context";
import { useRecordingWindow } from "./voice-control/recording-window-store";
import {
  useOptionalVoiceModeSession,
  VoiceModeSessionProvider,
} from "./chat/voice-mode/voice-mode-session";
import { registerVoiceShell } from "./chat/voice-mode/voice-ui-bridge";
import { RoomNavigation } from "./room-navigation";
import { navigationMessages } from "./room-navigation.messages";
import { roomSurfaceMessages } from "./room-surface.messages";
import {
  AuthenticatedRouteLoading,
  RoomNavigationLoading,
} from "./route-loading-surface";
import { TeamHubEventSync } from "./event-sync";
import { useAnotherMeArrival } from "./another-me-arrived";
import { AnotherMeArrivedBanner } from "./another-me-arrived-banner";
import { useAnotherMeNotifications } from "./another-me-notifications";
import { useRoomMentionNotifications } from "./room-mention-notifications";
import { useRoomWindowTitle } from "./room-unread-title";
import { useReturnToArrivedRoom } from "./use-return-to-arrived-room";
import { clearDismissedBackgroundFailure } from "./chat/another-me-background-failure-dismissal";
import { requireRoomRouteParam } from "./room-route-params";
import { useScrollPaneActivity } from "./use-scroll-pane-activity";
import {
  anotherMeQueryOptions,
  teamHubTenantQueryOptions,
  teamHubIdentityQueryOptions,
  tenantRoomsQueryOptions,
} from "./room-queries";

// Opened on demand, so these stay off the initial JavaScript graph.
const VoiceModeMiniWindow = lazy(
  () => import("./chat/voice-mode/voice-mode-mini-window"),
);
const RecordingWindow = lazy(() => import("./voice-control/recording-window"));
const PocketNoteHost = lazy(() =>
  import("./pocket-notes/pocket-note-host").then((module) => ({
    default: module.PocketNoteHost,
  })),
);
const RoomCreator = lazy(async () => ({
  default: (await import("./room-creator")).RoomCreator,
}));
const GlobalSearchDialog = lazy(async () => ({
  default: (await import("@/features/search/global-search-dialog"))
    .GlobalSearchDialog,
}));
const LocalComputerGate = lazy(async () => ({
  default: (await import("@/features/local-computer/local-computer-gate"))
    .LocalComputerGate,
}));
const RoomAddMembersDialog = lazy(async () => ({
  default: (await import("./members/room-add-members-dialog"))
    .RoomAddMembersDialog,
}));
const MeetingCarryBar = lazy(async () => ({
  default: (await import("@/features/memory/meeting-carry-bar"))
    .MeetingCarryBar,
}));

const EMPTY_ROOMS: TeamHubRoomListItem[] = [];

export function RoomShell() {
  const logout = useLogout();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  return <RoomShellReady logout={logout} tenantId={tenantId} />;
}

function RoomShellReady({
  logout,
  tenantId,
}: {
  logout: ReturnType<typeof useLogout>;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const t = useT();
  const roomsQuery = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const { data: identity } = useSuspenseQuery(
    teamHubIdentityQueryOptions(client),
  );
  const spaceOwnerName = spaceOwnerNameFor(identity, tenantId);
  const anotherMeQuery = useQuery(anotherMeQueryOptions(client, tenantId));
  const anotherMe = anotherMeQuery.data;
  // The Another Me card leads the Room list. Holding the list until both have
  // settled lets them land together, instead of the card arriving later and
  // pushing every row down.
  const navigationPending = roomsQuery.isPending || anotherMeQuery.isPending;
  // Settings stays open under the gate: a Computer whose only app is Pi gets
  // its first model from Settings › Models.
  const onSettings = useMatch("/t/:tenantId/settings/*") !== null;
  const needsComputer = anotherMeQuery.isSuccess && !anotherMe?.agent_actor_id;
  const gated = needsComputer && !onSettings;
  const [bypassAccountId, setBypassAccountId] = useState<string | null>(null);
  if (
    bypassAccountId !== null &&
    (!needsComputer || bypassAccountId !== identity.account.id)
  ) {
    setBypassAccountId(null);
  }
  const readOnlyBypass = gated && bypassAccountId === identity.account.id;
  const gateBlocking = gated && !readOnlyBypass;
  const navigate = useNavigate();
  const wasGated = useRef(false);
  const anotherMeRoomId = anotherMe?.room_id;
  const hasBackgroundFailure = Boolean(anotherMe?.background_failure);
  // Clear a session dismissal as soon as TeamHub drops the failure streak,
  // even while the Human is viewing another Room and the banner is unmounted.
  useEffect(() => {
    if (anotherMeRoomId && !hasBackgroundFailure) {
      clearDismissedBackgroundFailure(tenantId, anotherMeRoomId);
    }
  }, [anotherMeRoomId, hasBackgroundFailure, tenantId]);
  // The gate lands the Human in the Another Me Chat it waited for, once they
  // are back from Settings.
  useEffect(() => {
    if (gated) {
      wasGated.current = true;
    } else if (wasGated.current && anotherMeRoomId && !onSettings) {
      wasGated.current = false;
      void navigate(`/t/${tenantId}/rooms/${anotherMeRoomId}/chat`);
    }
  }, [anotherMeRoomId, gated, navigate, onSettings, tenantId]);

  const openRoom = useCallback(
    (roomId: string, messageId?: string) => {
      const path = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;
      // The chat reads the `message` parameter the pinned-message jump sets, so
      // a notice lands on its Message without a second focusing path. Opening
      // the Room already on screen still navigates, which makes the jump work
      // there too.
      void navigate(
        messageId
          ? `${path}?${new URLSearchParams({ message: messageId })}`
          : path,
      );
    },
    [navigate, tenantId],
  );
  useAnotherMeNotifications({
    accountId: identity.account.id,
    rooms: roomsQuery.data?.items,
    roomId: anotherMeRoomId,
    agentActorId: anotherMe?.agent_actor_id,
    open: openRoom,
  });
  // The shell is above the Room route, so it reads the open Room from the URL.
  const activeRoomId = useMatch("/t/:tenantId/rooms/:roomId/*")?.params.roomId;
  const onRoomRoute = useMatch("/t/:tenantId/rooms/*") !== null;
  const arrived = useAnotherMeArrival({
    accountId: identity.account.id,
    activeRoomId,
    agentActorId: anotherMe?.agent_actor_id,
    anotherMeRoomId,
    rooms: roomsQuery.data?.items,
  });
  useRoomMentionNotifications({
    accountId: identity.account.id,
    rooms: roomsQuery.data?.items,
    roomId: activeRoomId,
    open: openRoom,
  });
  useRoomWindowTitle({
    baseTitle: t(navigationMessages.space, { name: spaceOwnerName }),
    rooms: roomsQuery.data?.items,
  });
  useReturnToArrivedRoom({
    accountId: identity.account.id,
    activeRoomId,
    client,
    gated: gateBlocking,
    navigate,
    onRoomRoute,
    queryClient,
    rooms: roomsQuery.data?.items,
    tenantId,
  });
  useOpenMeetingAtStart(tenantId);

  useEffect(() => {
    performance.mark("room.shell_visible");
  }, []);

  const rooms = roomsQuery.data;
  return (
    <VoiceControlProvider
      key={`${identity.account.id}:${tenantId}`}
      tenantId={tenantId}
    >
      <TeamHubEventSync />
      {/* Voice Mode lives above the Room routes so it survives navigation. */}
      <VoiceModeSessionProvider key={`${identity.account.id}:${tenantId}`}>
        {gateBlocking ? (
          <Suspense fallback={null}>
            <LocalComputerGate
              onBrowseReadOnly={() => setBypassAccountId(identity.account.id)}
              onSignOut={logout.mutate}
              signingOut={logout.isPending}
              tenantId={tenantId}
            />
          </Suspense>
        ) : null}
        <RoomShellContent
          inert={gateBlocking}
          logout={logout}
          onConnectComputer={
            readOnlyBypass ? () => setBypassAccountId(null) : undefined
          }
          rooms={
            navigationPending ? EMPTY_ROOMS : (rooms?.items ?? EMPTY_ROOMS)
          }
          navigationStatus={
            navigationPending ? (
              <>
                <span className="sr-only" role="status">
                  {t(navigationMessages.loadingRooms)}
                </span>
                <RoomNavigationLoading />
              </>
            ) : roomsQuery.isError ? (
              <div role="alert">
                {t(navigationMessages.roomsUnavailable)}{" "}
                <Button onClick={() => void roomsQuery.refetch()}>
                  {t(navigationMessages.retryRooms)}
                </Button>
              </div>
            ) : undefined
          }
          anotherMeActorId={anotherMe?.agent_actor_id}
          anotherMeRoomId={anotherMe?.room_id}
          tenantId={tenantId}
        />
        {arrived.arrival && anotherMeRoomId ? (
          <AnotherMeArrivedBanner
            arrival={arrived.arrival}
            onDismiss={arrived.dismiss}
            onOpen={() => openRoom(anotherMeRoomId, arrived.arrival?.messageId)}
          />
        ) : null}
      </VoiceModeSessionProvider>
    </VoiceControlProvider>
  );
}

/** Loads the floating voice window only while a Voice Mode session runs. */
function VoiceModeWindowHost(props: {
  anotherMeActorId?: string;
  currentActorId?: string;
}) {
  if (!useOptionalVoiceModeSession()?.session) return null;
  return (
    <Suspense fallback={null}>
      <VoiceModeMiniWindow {...props} />
    </Suspense>
  );
}

/**
 * Loads the Recording window while it is open or a recording is running,
 * whichever page is showing, so leaving a page never ends a recording. A
 * stopped recording saves in the background without reopening the window.
 */
function RecordingWindowHost() {
  const livekit = useOptionalVoiceControl();
  const { open } = useRecordingWindow();
  const status = livekit?.captureState?.status;
  const running = Boolean(status && !notRunningStatuses.has(status));
  if (!open && !running) return null;
  return (
    <Suspense fallback={null}>
      <RecordingWindow />
    </Suspense>
  );
}

const notRunningStatuses = new Set<string>([
  "idle",
  "completed",
  "failed",
  "finalizing",
  "recovering",
  "permission_blocked",
  "processing",
  "processing_failed",
  "stop_pending",
]);

/** The Profile names the space after the Account's Actor; the rail matches it. */
function spaceOwnerNameFor(identity: TeamHubCurrentIdentity, tenantId: string) {
  return (
    identity.actors.find((actor) => actor.tenant_id === tenantId)
      ?.display_name || identity.account.email
  );
}

function RoomShellContent({
  inert,
  logout,
  onConnectComputer,
  anotherMeActorId,
  anotherMeRoomId,
  navigationStatus,
  rooms,
  tenantId,
}: {
  inert: boolean;
  logout: ReturnType<typeof useLogout>;
  onConnectComputer?: () => void;
  anotherMeActorId?: string;
  anotherMeRoomId?: string;
  rooms: TeamHubRoomListItem[];
  navigationStatus?: ReactNode;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const carriedMeeting = useCarriedMeeting();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  useScrollPaneActivity();
  const newRoomId =
    typeof location.state?.newRoomId === "string" &&
    location.pathname ===
      `/t/${tenantId}/rooms/${location.state.newRoomId}/chat`
      ? (location.state.newRoomId as string)
      : undefined;

  const navigation = useNavigation();
  const { data: tenant } = useSuspenseQuery(
    teamHubTenantQueryOptions(client, tenantId),
  );
  const { data: identity } = useSuspenseQuery(
    teamHubIdentityQueryOptions(client),
  );
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const roomOpen = Boolean(useParams().roomId);
  const openMobileNavigation = useCallback(
    () => setMobileNavigationOpen(true),
    [],
  );
  const desktopShell = isDesktopShell();
  const [frameTitleSlot, setFrameTitleSlot] = useState<HTMLElement | null>(
    null,
  );
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // What a spoken search asked for; the shortcut opens an empty search.
  const [searchQuery, setSearchQuery] = useState("");
  // The Room header opens the same dialog narrowed to its Room. The shortcut
  // and voice stay Tenant-wide.
  const [searchRoom, setSearchRoom] = useState<SearchRoomScope>();
  const closeGlobalSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchRoom(undefined);
  }, []);
  const openGlobalSearch = useCallback(() => {
    setSearchQuery("");
    setSearchRoom(undefined);
    setSearchOpen(true);
  }, []);
  const openRoomSearch = useCallback((room: SearchRoomScope) => {
    setSearchQuery("");
    setSearchRoom(room);
    setSearchOpen(true);
  }, []);
  const shellOutletContext: RoomShellOutletContext = useMemo(
    () => ({ openRoomSearch }),
    [openRoomSearch],
  );
  const onShortcutsSettings =
    location.pathname === `/t/${tenantId}/settings/shortcuts`;
  useGlobalSearchShortcut(
    () => {
      if (searchOpen) closeGlobalSearch();
      else openGlobalSearch();
    },
    {
      canTrigger: (event) => {
        if (onShortcutsSettings && !isEditableEventTarget(event.target)) {
          return false;
        }
        if (searchOpen) return !hasOtherOpenModal(".global-search");
        return !hasOpenModal();
      },
      enabled: !inert,
    },
  );
  useJumpShortcut(
    () => {
      closeGlobalSearch();
      void navigate(jumpPath(tenantId));
    },
    {
      canTrigger: (event) =>
        !(onShortcutsSettings && !isEditableEventTarget(event.target)) &&
        !hasOpenModal(),
      enabled: !inert,
    },
  );
  // Voice page actions wait while a route is loading: lazy routes commit
  // their URL only once their code has arrived.
  const navigating = useRef(false);
  useEffect(() => {
    navigating.current = navigation.state !== "idle";
  }, [navigation.state]);
  // Live voice opens rooms, goes back and searches through this shell.
  useEffect(
    () =>
      registerVoiceShell({
        back: () => void navigate(-1),
        navigate: (path) => void navigate(path),
        navigating: () => navigating.current,
        openSearch: (query) => {
          setSearchRoom(undefined);
          setSearchQuery(query);
          setSearchOpen(true);
        },
      }),
    [navigate],
  );
  const settingsOpen = location.pathname.startsWith(`/t/${tenantId}/settings/`);
  const pendingPathname = navigation.location?.pathname;
  const changingPage =
    navigation.state !== "idle" &&
    Boolean(pendingPathname) &&
    routeLayoutKey(pendingPathname!) !== routeLayoutKey(location.pathname);
  const loadingPathname = changingPage ? pendingPathname! : location.pathname;

  return (
    <ActorAvatarImageProvider identity={identity} tenantId={tenantId}>
      <OpenMobileNavigationContext value={openMobileNavigation}>
        {/* Inside the avatar provider so the window can show Another Me. */}
        <RecordingWindowHost />
        <Suspense fallback={null}>
          <PocketNoteHost accountId={identity.account.id} />
        </Suspense>
        <VoiceModeWindowHost
          anotherMeActorId={anotherMeActorId}
          currentActorId={
            identity.actors.find((actor) => actor.tenant_id === tenantId)?.id
          }
        />
        <div
          className="app-shell flex h-dvh min-h-0 overflow-hidden bg-app-canvas text-app-ink"
          inert={inert}
        >
          <RoomNavigation
            accountId={identity.account.id}
            username={spaceOwnerNameFor(identity, tenantId)}
            accountMenu={
              <AccountMenu
                identity={identity}
                tenantId={tenantId}
                isPending={logout.isPending}
                onLogout={logout.mutate}
                onNavigate={() => setMobileNavigationOpen(false)}
                onOpenSettings={() =>
                  void navigate(`/t/${tenantId}/settings/account`)
                }
                settingsOpen={settingsOpen}
              />
            }
            mobileOpen={mobileNavigationOpen}
            onCloseMobile={() => setMobileNavigationOpen(false)}
            onCreateRoom={() => setCreateRoomOpen(true)}
            onOpenSearch={openGlobalSearch}
            pendingPathname={navigation.location?.pathname}
            rooms={rooms}
            anotherMeRoomId={anotherMeRoomId}
            navigationStatus={navigationStatus}
            tenant={tenant}
          />
          <div className="app-work-surface flex min-w-0 flex-1 flex-col">
            {/* A Room puts this menu button in its own header, so narrow
              screens keep one top bar there. */}
            {roomOpen ? null : (
              <div className="flex h-(--app-header-height) shrink-0 items-center gap-3 bg-app-sidebar px-3 md:hidden">
                <MobileNavigationButton />
                <span className="truncate text-sm font-medium">
                  {t(navigationMessages.space, {
                    name: spaceOwnerNameFor(identity, tenantId),
                  })}
                </span>
              </div>
            )}
            {onConnectComputer ? (
              <div
                className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-4 py-2 text-xs text-foreground"
                role="status"
              >
                <span>{t(roomSurfaceMessages.readOnlyModeBanner)}</span>
                <Button
                  onClick={onConnectComputer}
                  size="compact"
                  tone="secondary"
                >
                  {t(roomSurfaceMessages.connectComputer)}
                </Button>
              </div>
            ) : null}
            {logout.error ? (
              <div
                className="flex shrink-0 items-center gap-3 px-4 py-3 text-sm text-app-danger"
                role="alert"
              >
                <span>{t(authMessages.logoutUnconfirmed)}</span>
                <Button
                  data-voice-risk="never"
                  loading={logout.isPending}
                  onClick={logout.mutate}
                  tone="ghost"
                >
                  {logout.isPending
                    ? t(roomSurfaceMessages.loggingOut)
                    : t(roomSurfaceMessages.retryLogout)}
                </Button>
              </div>
            ) : null}
            {/* Pages without their own header row put their title in this bar
              on the desktop window frame; Room and Library hide it. */}
            {desktopShell ? (
              <div className="desktop-frame-bar">
                <div className="flex min-w-0 flex-1" ref={setFrameTitleSlot} />
              </div>
            ) : null}
            <div className="app-page-card flex min-h-0 min-w-0 flex-1 flex-col">
              <DesktopBarSlot value={frameTitleSlot}>
                {changingPage ? (
                  <AuthenticatedRouteLoading
                    pathname={loadingPathname}
                    rooms={rooms}
                  />
                ) : (
                  <Suspense
                    fallback={
                      <AuthenticatedRouteLoading
                        pathname={loadingPathname}
                        rooms={rooms}
                      />
                    }
                    key={routeLayoutKey(location.pathname)}
                  >
                    <Outlet context={shellOutletContext} />
                  </Suspense>
                )}
              </DesktopBarSlot>
            </div>
            {carriedMeeting ? (
              <Suspense fallback={null}>
                <MeetingCarryBar key={carriedMeeting.meetingId} />
              </Suspense>
            ) : null}
          </div>
          {newRoomId ? (
            <Suspense fallback={null}>
              <RoomAddMembersDialog
                key={newRoomId}
                tenantId={tenantId}
                roomId={newRoomId}
                onClose={() => {
                  const state = { ...location.state };
                  delete state.newRoomId;
                  void navigate(location.pathname + location.search, {
                    replace: true,
                    state,
                  });
                }}
              />
            </Suspense>
          ) : null}
          {createRoomOpen ? (
            <Suspense fallback={null}>
              <RoomCreator
                onClose={() => setCreateRoomOpen(false)}
                tenantId={tenantId}
              />
            </Suspense>
          ) : null}
          {searchOpen ? (
            <Suspense fallback={null}>
              <GlobalSearchDialog
                key={searchRoom?.id ?? "global"}
                initialQuery={searchQuery}
                onClose={closeGlobalSearch}
                room={searchRoom}
                tenantId={tenantId}
              />
            </Suspense>
          ) : null}
        </div>
      </OpenMobileNavigationContext>
    </ActorAvatarImageProvider>
  );
}

const OPEN_MODAL_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"]';

function hasOpenModal() {
  return document.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

function hasOtherOpenModal(exemptSelector: string) {
  return Array.from(document.querySelectorAll(OPEN_MODAL_SELECTOR)).some(
    (modal) => !modal.matches(exemptSelector),
  );
}

function isEditableEventTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) !== null
  );
}
