import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { DesktopBarTitle } from "@/app/desktop-frame";
import { type MouseEvent, type ReactNode, useState } from "react";
import { useSearchParams } from "react-router";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { cn } from "@/lib/cn";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubExternalApp,
  TeamHubExternalAppKey,
  TeamHubExternalConnection,
} from "@/features/teamhub/teamhub-types";
import {
  connectedWebSearchBackends,
  shownWebSearchBackends,
  webSearchBackendsQueryOptions,
} from "@/features/web-search/web-search-backends";
import { commonMessages } from "@/i18n/common.messages";
import type { Translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";

import { AppLogo } from "./app-logo";
import {
  ANOTHER_ME_ONLY_APPS,
  appSummary,
  groupCatalogApps,
  WEB_SEARCH_FILTER,
} from "./app-groups";
import {
  AppManageDialog,
  DisconnectConnectionDialog,
} from "./app-manage-dialog";
import {
  activeExternalConnections,
  externalConnectionNeedsAttention,
  openPendingExternalConnection,
  externalConnectionUnconfirmed,
} from "./connection-state";
import {
  externalAppsQueryOptions,
  externalConnectionsQueryOptions,
} from "./connected-apps-queries";
import { ConnectAppStatus, useConnectAppFlow } from "./connect-app-flow";
import { connectorMessages as m } from "./connectors.messages";
import { WebSearchSection } from "./web-search-connectors";

const APP_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

function stopCardClick(event: MouseEvent) {
  event.stopPropagation();
}

function matchesConnectorQuery(
  app: TeamHubExternalApp,
  normalizedQuery: string,
  t: Translate,
): boolean {
  if (!normalizedQuery) return true;
  return (
    app.display_name.toLowerCase().includes(normalizedQuery) ||
    appSummary(app, t).toLowerCase().includes(normalizedQuery) ||
    app.description.toLowerCase().includes(normalizedQuery)
  );
}

export function ConnectedAppsPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedApp = searchParams.get("app");
  const requestedTab = searchParams.get("tab");
  const connectedParam = searchParams.get("connected");
  const connectedOnly = connectedParam === "1" || connectedParam === "true";
  const [searchQuery, setSearchQuery] = useState("");
  const apps = useQuery(externalAppsQueryOptions(client));
  const connections = useQuery(externalConnectionsQueryOptions(client));
  const webSearch = useQuery(webSearchBackendsQueryOptions(client));
  // TeamHub lists only Connections that are not revoked.
  const visibleConnections = connections.data?.connections ?? [];
  const allApps = apps.data?.apps ?? [];
  const groups = groupCatalogApps(allApps);
  const catalogApps = groups.flatMap((entry) => entry.apps);
  // Apps outside the groups are not offered, but an account already connected
  // or needing reconnection stays reachable here so it can be repaired or
  // disconnected, unless it is shared only with AnotherMe.
  const connectedApps = [
    ...catalogApps,
    ...allApps.filter((app) => !catalogApps.includes(app)),
  ].filter((app) => {
    if (ANOTHER_ME_ONLY_APPS.has(app.key)) return false;
    const appConnections = visibleConnections.filter(
      (connection) => connection.provider === app.key,
    );
    return (
      activeExternalConnections(appConnections).length > 0 ||
      appConnections.some(externalConnectionNeedsAttention)
    );
  });
  const activeGroupEntry = requestedTab
    ? groups.find((entry) => entry.group.id === requestedTab)
    : undefined;
  const filter =
    requestedTab === WEB_SEARCH_FILTER.id
      ? WEB_SEARCH_FILTER.id
      : activeGroupEntry
        ? activeGroupEntry.group.id
        : "all";
  const filters = [
    { id: "all", label: t(m.filterAll) },
    ...groups.map(({ group }) => ({ id: group.id, label: t(group.title) })),
    { id: WEB_SEARCH_FILTER.id, label: t(WEB_SEARCH_FILTER.label) },
  ];
  const trimmedQuery = searchQuery.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const hasSearch = normalizedQuery.length > 0;
  const hasAnyFilter = hasSearch || connectedOnly || filter !== "all";
  const groupApps = activeGroupEntry?.apps;
  // Connected only and search narrow whichever view is open; with All and no search,
  // sections keep their category headings.
  const baseFlatApps = connectedOnly
    ? (groupApps ?? connectedApps).filter((app) => connectedApps.includes(app))
    : hasSearch
      ? (groupApps ?? catalogApps)
      : groupApps;
  const filteredApps = baseFlatApps
    ? baseFlatApps.filter((app) =>
        matchesConnectorQuery(app, normalizedQuery, t),
      )
    : undefined;
  const allSearchBackends = webSearch.data?.backends ?? [];
  const baseSearchBackends = connectedOnly
    ? connectedWebSearchBackends(allSearchBackends)
    : shownWebSearchBackends(allSearchBackends);
  const searchBackends = hasSearch
    ? baseSearchBackends.filter(
        (backend) =>
          backend.name.toLowerCase().includes(normalizedQuery) ||
          backend.description.toLowerCase().includes(normalizedQuery),
      )
    : baseSearchBackends;
  const searchFilter = filter === WEB_SEARCH_FILTER.id;
  // DuckDuckGo needs no key, so Connected only always keeps the section;
  // when searching across All, hide Web search if no backend matches.
  const showSearch =
    searchFilter ||
    (filter === "all" && (!hasSearch || searchBackends.length > 0));
  const emptySearchTab =
    searchFilter &&
    hasSearch &&
    !webSearch.isPending &&
    !webSearch.error &&
    searchBackends.length === 0;
  const showApps =
    !searchFilter && (!showSearch || !filteredApps || filteredApps.length > 0);
  const emptyMessage = hasSearch
    ? filter !== "all" || connectedOnly
      ? t(m.noConnectorsMatchInView, { query: trimmedQuery })
      : t(m.noConnectorsMatch, { query: trimmedQuery })
    : connectedOnly
      ? activeGroupEntry
        ? t(m.noConnectedAppsInGroup, {
            group: t(activeGroupEntry.group.title),
          })
        : t(m.noConnectedApps)
      : activeGroupEntry
        ? t(m.noConnectorsInGroup, { group: t(activeGroupEntry.group.title) })
        : t(m.noConnectorsAvailable);

  function setFilter(nextTab: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextTab === "all") next.delete("tab");
        else next.set("tab", nextTab);
        return next;
      },
      { replace: true },
    );
  }

  function toggleConnectedOnly() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (connectedOnly) next.delete("connected");
        else next.set("connected", "1");
        return next;
      },
      { replace: true },
    );
  }

  function resetFilters() {
    setSearchQuery("");
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("tab");
        next.delete("connected");
        return next;
      },
      { replace: true },
    );
  }

  function renderApp(app: TeamHubExternalApp) {
    return (
      <CatalogAppCard
        app={app}
        connections={visibleConnections.filter(
          (connection) => connection.provider === app.key,
        )}
        key={app.key}
        selected={requestedApp === app.key}
        onOpen={() => openApp(app.key)}
      />
    );
  }

  // Groups decide only what the grid offers; the dialog opens for any app
  // TeamHub lists, so links like Agent Info's `?app=googledrive` still work.
  const selectedApp = apps.data?.apps.find((app) => app.key === requestedApp);

  function openApp(appKey: TeamHubExternalAppKey) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("app", appKey);
        return next;
      },
      { replace: true },
    );
  }

  function closeApp() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("app");
        return next;
      },
      { replace: true },
    );
  }

  return (
    <main className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto bg-background [scrollbar-gutter:stable]">
      <div className="workspace-file-browser">
        <DesktopBarTitle>
          <h1 className="mb-5 text-2xl text-foreground">{t(m.title)}</h1>
        </DesktopBarTitle>
        {apps.isPending || connections.isPending ? (
          <PageMessage busy>{t(m.loadingConnectors)}</PageMessage>
        ) : apps.error || connections.error ? (
          <div className="py-10 text-center" role="alert">
            <p className="text-sm text-app-danger">
              {apps.error?.message ??
                connections.error?.message ??
                t(m.connectorsUnavailable)}
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                void Promise.all([apps.refetch(), connections.refetch()])
              }
              size="compact"
            >
              {t(commonMessages.retry)}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="select-pill min-w-0 flex-1 cursor-text pr-1.5 focus-within:ring-2 focus-within:ring-app-focus sm:max-w-xs">
                <Icon icon={Search01Icon} size={14} />
                <input
                  aria-label={t(m.searchConnectors)}
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && searchQuery) {
                      event.preventDefault();
                      setSearchQuery("");
                    }
                  }}
                  placeholder={t(m.searchConnectorsPlaceholder)}
                  role="searchbox"
                  type="text"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label={t(m.clearSearch)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                ) : null}
              </label>
              <Button
                aria-pressed={connectedOnly}
                className="shrink-0"
                onClick={toggleConnectedOnly}
                size="default"
                tone={connectedOnly ? "primary" : "secondary"}
              >
                {t(m.connectedOnly)}
              </Button>
            </div>
            {/* On narrow phones, the right fade cue signals additional category tabs off-screen. */}
            <div className="relative min-w-0">
              <UnderlineTabs
                className="pr-8"
                items={filters}
                label={t(m.connectorCategories)}
                onChange={setFilter}
                value={filter}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 right-0 h-9 w-10 bg-gradient-to-l from-background to-transparent lg:hidden"
                data-scroll-cue="tabs"
              />
            </div>
            {!showApps ? null : filteredApps ? (
              filteredApps.length ? (
                <section
                  aria-label={t(m.applicationConnections)}
                  className={APP_GRID_CLASS}
                >
                  {filteredApps.map(renderApp)}
                </section>
              ) : (
                <div className="flex flex-col items-center py-12 text-center">
                  <p className="text-sm text-muted-foreground" role="status">
                    {emptyMessage}
                  </p>
                  {hasAnyFilter ? (
                    <Button
                      className="mt-4"
                      onClick={resetFilters}
                      size="compact"
                      tone="secondary"
                    >
                      {t(m.showAllConnectors)}
                    </Button>
                  ) : null}
                </div>
              )
            ) : groups.length ? (
              <div aria-label={t(m.applicationConnections)} role="region">
                {groups.map(({ group, apps: groupApps }) => (
                  <section
                    aria-labelledby={`connector-group-${group.id}`}
                    className="mb-7 last:mb-0"
                    key={group.id}
                  >
                    <h2
                      className="mb-2.5 text-[14px] font-medium text-muted-foreground"
                      id={`connector-group-${group.id}`}
                    >
                      {t(group.title)}
                    </h2>
                    <div className={APP_GRID_CLASS}>
                      {groupApps.map(renderApp)}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <PageMessage>{emptyMessage}</PageMessage>
            )}
            {emptySearchTab ? (
              <div className="flex flex-col items-center py-12 text-center">
                <p className="text-sm text-muted-foreground" role="status">
                  {emptyMessage}
                </p>
                {hasAnyFilter ? (
                  <Button
                    className="mt-4"
                    onClick={resetFilters}
                    size="compact"
                    tone="secondary"
                  >
                    Show all connectors
                  </Button>
                ) : null}
              </div>
            ) : showSearch ? (
              <WebSearchSection
                backends={searchBackends}
                className={showApps ? "mt-7" : undefined}
                heading={!searchFilter}
                list={webSearch}
              />
            ) : null}
          </>
        )}
      </div>

      {selectedApp ? (
        <AppManageDialog
          app={selectedApp}
          connections={visibleConnections.filter(
            (connection) => connection.provider === selectedApp.key,
          )}
          onClose={closeApp}
        />
      ) : null}
    </main>
  );
}

function CatalogAppCard({
  app,
  connections,
  selected,
  onOpen,
}: {
  app: TeamHubExternalApp;
  connections: TeamHubExternalConnection[];
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const [disconnecting, setDisconnecting] =
    useState<TeamHubExternalConnection | null>(null);
  const connectFlow = useConnectAppFlow();
  const createConnection = connectFlow.connection;
  const active = activeExternalConnections(connections);
  const pending = openPendingExternalConnection(connections, app.key);
  const canConnect = app.availability === "available";
  const canStart = connectFlow.canStart(app);
  const attention = connections.filter(externalConnectionNeedsAttention);
  const needsReconnecting = attention.length;
  const connectedLabel = active.length
    ? active.length === 1
      ? needsReconnecting
        ? t(m.connectedNeedsReconnecting, { count: needsReconnecting })
        : t(m.connected)
      : needsReconnecting
        ? t(m.accountsNeedReconnecting, {
            accounts: active.length,
            count: needsReconnecting,
          })
        : t(m.accountCount, { count: active.length })
    : needsReconnecting
      ? needsReconnecting === 1
        ? t(m.needsReconnecting)
        : `${needsReconnecting} need reconnecting`
      : null;
  const authorizing =
    createConnection.isPending || Boolean(createConnection.blockedConnectUrl);
  const unconfirmed = connections.some(externalConnectionUnconfirmed);
  const summary =
    connectFlow.configured && app.availability === "unavailable"
      ? t(m.unavailable)
      : authorizing
        ? t(m.authorizing)
        : unconfirmed
          ? t(m.couldNotConfirm)
          : appSummary(app, t);

  return (
    <article
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3 transition-colors duration-150 motion-reduce:transition-none",
        selected
          ? "border-border-hover bg-muted"
          : "border-border hover:bg-accent/40",
      )}
    >
      <button
        aria-label={app.display_name}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-outline">
          <AppLogo name={app.display_name} url={app.logo_url} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {app.display_name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {connectedLabel ? (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  needsReconnecting > 0
                    ? "bg-app-warning"
                    : "bg-[var(--app-status-success-text)]",
                )}
              />
            ) : null}
            <span
              className={cn(
                "truncate",
                !connectedLabel && authorizing && "town-shimmer-text",
              )}
              title={connectedLabel ?? summary}
            >
              {connectedLabel ?? summary}
            </span>
          </span>
        </span>
      </button>
      {canStart && needsReconnecting > 0 ? (
        <Button
          aria-label={t(m.reconnectAccount, { account: app.display_name })}
          className="px-2.5"
          disabled={createConnection.isPending}
          onClick={(event) => {
            stopCardClick(event);
            if (attention.length === 1) {
              const broken = attention[0]!;
              if (app.supports_reauthorization === false) {
                connectFlow.start(app, pending);
              } else {
                connectFlow.reconnect(broken);
              }
            } else {
              onOpen();
            }
          }}
          size="compact"
          tone="secondary"
        >
          {t(m.reconnect)}
        </Button>
      ) : canStart && active.length === 0 ? (
        <Button
          aria-label={t(m.connectApp, { app: app.display_name })}
          className="px-2.5"
          disabled={createConnection.isPending}
          onClick={(event) => {
            stopCardClick(event);
            connectFlow.start(app, pending);
          }}
          size="compact"
          tone="secondary"
        >
          {t(m.connect)}
        </Button>
      ) : null}
      {canConnect && active.length >= 1 ? (
        // Disconnecting is destructive, so it sits in a menu, not beside Connect.
        <ActionMenu
          items={
            active.length === 1
              ? [
                  { label: t(m.manage), onSelect: onOpen },
                  {
                    danger: true,
                    label: t(m.disconnect),
                    onSelect: () => setDisconnecting(active[0] ?? null),
                  },
                ]
              : [{ label: t(m.manage), onSelect: onOpen }]
          }
          label={t(m.actionsFor, { app: app.display_name })}
        />
      ) : null}
      <ConnectAppStatus className="basis-full" flow={connectFlow} />
      {disconnecting ? (
        <DisconnectConnectionDialog
          connection={disconnecting}
          onClose={() => setDisconnecting(null)}
        />
      ) : null}
    </article>
  );
}

function PageMessage({
  busy,
  children,
}: {
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      aria-busy={busy}
      className="flex items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground"
      role="status"
    >
      {busy ? <Spinner size={16} /> : null}
      {children}
    </p>
  );
}
