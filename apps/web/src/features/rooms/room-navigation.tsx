import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";

import {
  BookOpen01Icon,
  DashboardSquare01Icon,
  LibrariesIcon,
  Message01Icon,
  Plug01Icon,
  Search01Icon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { isDesktopShell, useDesktopListCollapsed } from "@/app/desktop-shell";
import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconSvgElement } from "@/components/ui/icon";
import { NavigationDrawer } from "@/components/ui/navigation-drawer";
import { useRoomListWidth } from "@/components/ui/use-sidebar-width";
import { searchShortcutLabel } from "@/features/search/search-shortcut";
import { useT } from "@/i18n/use-translation";
import {
  documentQueryOptions,
  teamHubIdentityQueryOptions,
} from "./room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRoomListItem,
  TeamHubTenant,
} from "@/features/teamhub/teamhub-types";

import { navigationMessages } from "./room-navigation.messages";
import { useRoomActivity } from "./use-room-activity";

const RoomSecondaryNavigation = lazy(async () => ({
  default: (await import("./room-secondary-navigation"))
    .RoomSecondaryNavigation,
}));

/** Matches --app-emphasized-duration in globals.css. */
const RAIL_TOGGLE_MS = 450;

export function RoomNavigation({
  accountId,
  accountMenu,
  username,
  anotherMeRoomId,
  navigationStatus,
  mobileOpen,
  onCloseMobile,
  onCreateRoom,
  onOpenSearch,
  pendingPathname,
  rooms,
  tenant,
}: {
  /** Scopes the away recap's dismissal to this Account in this Tenant. */
  accountId?: string;
  accountMenu?: ReactNode;
  username: string;
  anotherMeRoomId?: string;
  navigationStatus?: ReactNode;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onCreateRoom: () => void;
  onOpenSearch?: () => void;
  pendingPathname?: string;
  rooms: TeamHubRoomListItem[];
  tenant: TeamHubTenant;
}) {
  const location = useLocation();
  const t = useT();
  const spaceName = t(navigationMessages.space, { name: username });
  const [expanded, setExpanded] = useState(false);
  // Width also changes when the Room list is dragged wider; animating only while
  // the rail is toggling keeps the drag following the pointer with no lag.
  const [railToggling, setRailToggling] = useState(false);
  useEffect(() => {
    if (!railToggling) return;
    const timer = setTimeout(() => setRailToggling(false), RAIL_TOGGLE_MS + 80);
    return () => clearTimeout(timer);
  }, [railToggling, expanded]);
  // The desktop app lets the Chat list beside the rail collapse.
  const desktopShell = isDesktopShell();
  const navigationWidth = useRoomListWidth(tenant.id);
  const [listCollapsed, setListCollapsed] = useDesktopListCollapsed(tenant.id);
  const { roomId, documentId } = useParams();
  const { client } = useTeamHubRuntime();
  const identity = useQuery({
    ...teamHubIdentityQueryOptions(client),
    enabled: typeof client.api?.GET === "function",
  });
  const actorId = identity.data?.actors.find(
    (actor) => actor.tenant_id === tenant.id,
  )?.id;
  const document = useQuery({
    ...documentQueryOptions(client, tenant.id, documentId ?? ""),
    enabled: Boolean(documentId),
  });
  const effectivePathname = pendingPathname ?? location.pathname;
  const effectiveRoomId =
    roomIdFromPath(effectivePathname, tenant.id) ?? roomId;
  const tenantPrefix = `/t/${tenant.id}`;
  const roomNavigationVisible = effectivePathname.startsWith(
    `${tenantPrefix}/rooms`,
  );
  const dashboardVisible =
    effectivePathname.startsWith(`${tenantPrefix}/dashboard`) ||
    effectivePathname.startsWith(`${tenantPrefix}/work-items`);
  const secondaryNavigationVisible =
    roomNavigationVisible && !(desktopShell && listCollapsed);
  const mobilePrimaryOnly = mobileOpen && !secondaryNavigationVisible;
  const railExpanded = expanded || mobilePrimaryOnly;
  const wikiVisible =
    effectivePathname.startsWith(`${tenantPrefix}/library/wiki`) ||
    effectivePathname.startsWith(`${tenantPrefix}/wiki-preview`) ||
    effectivePathname.startsWith(`${tenantPrefix}/library/remembered`) ||
    effectivePathname.startsWith(`${tenantPrefix}/library/introduction`) ||
    effectivePathname.startsWith(`${tenantPrefix}/library/life`) ||
    (Boolean(documentId) &&
      document.data?.from.some(
        (source) => source.binding_kind === "wiki_page",
      ) === true);
  const workspaceVisible =
    !wikiVisible &&
    (effectivePathname.startsWith(`${tenantPrefix}/library`) ||
      effectivePathname.startsWith(`${tenantPrefix}/documents/`));
  const { failedRoomIds, runningRoomIds } = useRoomActivity(
    tenant.id,
    roomNavigationVisible && rooms.length > 0,
  );
  return (
    <NavigationDrawer
      ariaLabel="Room navigation"
      closeLabel={t(navigationMessages.closeNavigation)}
      onClose={onCloseMobile}
      open={mobileOpen}
    >
      <aside
        aria-label={t(navigationMessages.sidebar)}
        data-voice-area="sidebar"
        data-animating={railToggling || undefined}
        data-expanded={railExpanded}
        data-secondary-navigation={secondaryNavigationVisible || undefined}
        // The Library sidebar continues this rail as its secondary column,
        // so the rail draws no boundary of its own there, as beside Message.
        data-workspace-adjoined={workspaceVisible || wikiVisible || undefined}
        className={`app-navigation fixed inset-y-0 left-0 z-40 flex shrink-0 max-w-[86vw] bg-card transition-[transform,visibility] md:relative md:visible md:max-w-none md:translate-x-0 ${
          railExpanded
            ? secondaryNavigationVisible
              ? "w-[calc(220px+20px+var(--sidebar-width))]"
              : "w-[220px]"
            : secondaryNavigationVisible
              ? "w-[320px] md:w-[calc(var(--app-rail-width)+20px+var(--sidebar-width))]"
              : "w-(--app-rail-width)"
        } ${mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"}`}
        ref={navigationWidth.styleRef}
        style={navigationWidth.style}
      >
        <nav
          aria-label={t(navigationMessages.primary)}
          data-voice-area="navigation"
          className="app-primary-navigation flex min-h-0 shrink-0 flex-col bg-card"
        >
          <div className="primary-navigation-topbar">
            {railExpanded ? (
              <>
                <BrandMark className="room-brand-mark size-6 shrink-0" />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${
                    mobilePrimaryOnly ? "text-left" : "text-center"
                  }`}
                  title={spaceName}
                >
                  {spaceName}
                </span>
              </>
            ) : null}
            {mobilePrimaryOnly ? null : (
              <button
                aria-label={t(
                  expanded
                    ? navigationMessages.collapseSidebar
                    : navigationMessages.expandSidebar,
                )}
                aria-expanded={expanded}
                className="primary-navigation-toggle flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-sidebar-muted"
                onClick={() => {
                  setRailToggling(true);
                  setExpanded((value) => !value);
                }}
                type="button"
              >
                {expanded ? (
                  // The arrow says which way the open sidebar folds away.
                  <RoomRailGlyph icon={SidebarLeft01Icon} />
                ) : (
                  // Collapsed, the corner shows the brand and turns into the
                  // expand control only under the pointer or keyboard focus.
                  <>
                    <BrandMark className="room-brand-mark primary-navigation-toggle-logo size-6 shrink-0" />
                    <span className="primary-navigation-toggle-glyph">
                      <RoomRailGlyph icon={SidebarLeftIcon} />
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
          {desktopShell && roomNavigationVisible && listCollapsed ? (
            // The desktop app's Chat list folds away; this brings it back.
            <div className="primary-navigation-list-toggle">
              <button
                aria-label={t(navigationMessages.showChatList)}
                className="primary-navigation-toggle flex shrink-0 items-center justify-center text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink"
                onClick={() => setListCollapsed(false)}
                title={t(navigationMessages.showChatList)}
                type="button"
              >
                <RoomRailGlyph icon={SidebarLeftIcon} />
              </button>
            </div>
          ) : null}
          <div className="primary-navigation-items min-h-0 flex-1">
            <RailLink
              active={roomNavigationVisible}
              icon={<RoomRailGlyph icon={Message01Icon} />}
              label={t(navigationMessages.messages)}
              onNavigate={onCloseMobile}
              to={
                roomId
                  ? `/t/${tenant.id}/rooms/${roomId}/chat`
                  : `/t/${tenant.id}/rooms`
              }
            />
            <RailLink
              active={dashboardVisible}
              icon={<RoomRailGlyph icon={DashboardSquare01Icon} />}
              label="Dashboard"
              onNavigate={onCloseMobile}
              to={`/t/${tenant.id}/dashboard`}
            />
            <RailLink
              active={workspaceVisible}
              icon={<RoomRailGlyph icon={LibrariesIcon} />}
              label={t(navigationMessages.library)}
              onNavigate={onCloseMobile}
              to={`/t/${tenant.id}/library`}
            />
            <RailLink
              active={wikiVisible}
              icon={<RoomRailGlyph icon={BookOpen01Icon} />}
              label={t(navigationMessages.wiki)}
              onNavigate={onCloseMobile}
              to={`/t/${tenant.id}/library/wiki`}
            />
            <RailLink
              active={effectivePathname === `/t/${tenant.id}/apps`}
              icon={<RoomRailGlyph icon={Plug01Icon} />}
              label={t(navigationMessages.connectors)}
              onNavigate={onCloseMobile}
              to={`/t/${tenant.id}/apps`}
            />
            <RailSearchButton
              expanded={railExpanded}
              onClick={() => {
                onOpenSearch?.();
                onCloseMobile();
              }}
            />
          </div>
          <div className="primary-navigation-footer flex shrink-0 flex-col gap-1">
            {accountMenu}
          </div>
        </nav>

        {secondaryNavigationVisible ? (
          <Suspense fallback={null}>
            <RoomSecondaryNavigation
              accountId={accountId}
              activeRoomId={effectiveRoomId}
              actorId={actorId}
              onCloseMobile={onCloseMobile}
              onCreateRoom={onCreateRoom}
              onOpenSearch={onOpenSearch}
              rooms={rooms}
              failedRoomIds={failedRoomIds}
              runningRoomIds={runningRoomIds}
              anotherMeRoomId={anotherMeRoomId}
              navigationStatus={navigationStatus}
              onCollapse={
                desktopShell ? () => setListCollapsed(true) : undefined
              }
              tenant={tenant}
            />
          </Suspense>
        ) : null}
        {secondaryNavigationVisible ? (
          <div
            {...navigationWidth.handleProps}
            aria-label={t(navigationMessages.resizeChatList)}
          />
        ) : null}
      </aside>
    </NavigationDrawer>
  );
}

function RoomRailGlyph({ icon }: { icon: IconSvgElement }) {
  return (
    <Icon
      className="room-rail-glyph pointer-events-none size-5 shrink-0"
      icon={icon}
      size={20}
    />
  );
}

function RailLink({
  active,
  icon,
  label,
  onNavigate,
  to,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onNavigate: () => void;
  to: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={`room-rail-link flex select-none items-center ${
        active ? "text-app-ink" : "text-app-muted"
      }`}
      onClick={onNavigate}
      to={to}
    >
      {icon}
      <span className="primary-navigation-label truncate">{label}</span>
    </Link>
  );
}

function RailSearchButton({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  const shortcut = searchShortcutLabel();
  return (
    <button
      aria-keyshortcuts="Control+k Meta+k"
      aria-label="Search"
      className="room-rail-link flex cursor-pointer select-none items-center text-app-muted"
      onClick={onClick}
      title={`Search (${shortcut})`}
      type="button"
    >
      <Icon
        className="room-rail-glyph pointer-events-none shrink-0"
        icon={Search01Icon}
        size={16}
      />
      <span className="primary-navigation-label truncate">Search</span>
      {expanded ? (
        <kbd className="ml-auto mr-2 shrink-0 font-sans text-2xs text-app-subtle">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

function roomIdFromPath(pathname: string, tenantId: string) {
  const prefix = `/t/${tenantId}/rooms/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const roomId = pathname.slice(prefix.length).split("/")[0];
  return roomId ? decodeURIComponent(roomId) : undefined;
}
