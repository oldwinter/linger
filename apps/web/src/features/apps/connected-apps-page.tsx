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

import { AppLogo } from "./app-logo";
import { appSummary, groupCatalogApps } from "./app-groups";
import {
  AppManageDialog,
  DisconnectConnectionDialog,
} from "./app-manage-dialog";
import {
  activeExternalConnections,
  externalConnectionNeedsAttention,
  openPendingExternalConnection,
} from "./connection-state";
import {
  externalAppsQueryOptions,
  externalConnectionsQueryOptions,
} from "./connected-apps-queries";
import { ConnectAppStatus, useConnectAppFlow } from "./connect-app-flow";

const APP_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

function stopCardClick(event: MouseEvent) {
  event.stopPropagation();
}

function matchesConnectorQuery(
  app: TeamHubExternalApp,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return (
    app.display_name.toLowerCase().includes(normalizedQuery) ||
    appSummary(app).toLowerCase().includes(normalizedQuery) ||
    app.description.toLowerCase().includes(normalizedQuery)
  );
}

export function ConnectedAppsPage() {
  const { client } = useTeamHubRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedApp = searchParams.get("app");
  const requestedTab = searchParams.get("tab");
  const connectedParam = searchParams.get("connected");
  const connectedOnly = connectedParam === "1" || connectedParam === "true";
  const [searchQuery, setSearchQuery] = useState("");
  const apps = useQuery(externalAppsQueryOptions(client));
  const connections = useQuery(externalConnectionsQueryOptions(client));
  // TeamHub lists only Connections that are not revoked.
  const visibleConnections = connections.data?.connections ?? [];
  const allApps = apps.data?.apps ?? [];
  const groups = groupCatalogApps(allApps);
  const catalogApps = groups.flatMap((entry) => entry.apps);
  // Apps outside the groups are not offered, but an account already connected
  // or needing reconnection stays reachable here so it can be repaired or disconnected.
  const connectedApps = [
    ...catalogApps,
    ...allApps.filter((app) => !catalogApps.includes(app)),
  ].filter((app) => {
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
  const filter = activeGroupEntry ? activeGroupEntry.group.id : "all";
  const filters = [
    { id: "all", label: "All" },
    ...groups.map(({ group }) => ({ id: group.id, label: group.title })),
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
    ? baseFlatApps.filter((app) => matchesConnectorQuery(app, normalizedQuery))
    : undefined;
  const emptyMessage = hasSearch
    ? filter !== "all" || connectedOnly
      ? `No connectors match “${trimmedQuery}” in this view.`
      : `No connectors match “${trimmedQuery}”.`
    : connectedOnly
      ? activeGroupEntry
        ? `No connected apps in ${activeGroupEntry.group.title} yet.`
        : "No connected apps yet."
      : activeGroupEntry
        ? `No connectors in ${activeGroupEntry.group.title} yet.`
        : "No connectors available yet.";

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
          <h1 className="mb-5 text-2xl text-foreground">Connectors</h1>
        </DesktopBarTitle>
        {apps.isPending || connections.isPending ? (
          <PageMessage busy>Loading connectors...</PageMessage>
        ) : apps.error || connections.error ? (
          <div className="py-10 text-center" role="alert">
            <p className="text-sm text-app-danger">
              {apps.error?.message ??
                connections.error?.message ??
                "Connectors are unavailable."}
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                void Promise.all([apps.refetch(), connections.refetch()])
              }
              size="compact"
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="select-pill min-w-0 flex-1 cursor-text pr-1.5 focus-within:ring-2 focus-within:ring-app-focus sm:max-w-xs">
                <Icon icon={Search01Icon} size={14} />
                <input
                  aria-label="Search connectors"
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && searchQuery) {
                      event.preventDefault();
                      setSearchQuery("");
                    }
                  }}
                  placeholder="Search connectors..."
                  role="searchbox"
                  type="text"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label="Clear search"
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
                Connected only
              </Button>
            </div>
            {/* On narrow phones, the right fade cue signals additional category tabs off-screen. */}
            <div className="relative min-w-0">
              <UnderlineTabs
                className="pr-8"
                items={filters}
                label="Connector categories"
                onChange={setFilter}
                value={filter}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 right-0 h-9 w-10 bg-gradient-to-l from-background to-transparent lg:hidden"
                data-scroll-cue="tabs"
              />
            </div>
            {filteredApps ? (
              filteredApps.length ? (
                <section
                  aria-label="Application connections"
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
                      Show all connectors
                    </Button>
                  ) : null}
                </div>
              )
            ) : groups.length ? (
              <div aria-label="Application connections" role="region">
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
                      {group.title}
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
    ? `${active.length === 1 ? "Connected" : `${active.length} accounts`}${
        needsReconnecting
          ? `, ${needsReconnecting} ${needsReconnecting === 1 ? "needs" : "need"} reconnecting`
          : ""
      }`
    : needsReconnecting
      ? needsReconnecting === 1
        ? "Needs reconnecting"
        : `${needsReconnecting} need reconnecting`
      : null;
  const authorizing =
    createConnection.isPending || Boolean(createConnection.blockedConnectUrl);
  const summary =
    connectFlow.configured && app.availability === "unavailable"
      ? "Unavailable"
      : authorizing
        ? "Authorizing…"
        : appSummary(app);

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
            >
              {connectedLabel ?? summary}
            </span>
          </span>
        </span>
      </button>
      {canStart && needsReconnecting > 0 ? (
        <Button
          aria-label={`Reconnect ${app.display_name}`}
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
          Reconnect
        </Button>
      ) : canStart && active.length === 0 ? (
        <Button
          aria-label={`Connect ${app.display_name}`}
          className="px-2.5"
          disabled={createConnection.isPending}
          onClick={(event) => {
            stopCardClick(event);
            connectFlow.start(app, pending);
          }}
          size="compact"
          tone="secondary"
        >
          Connect
        </Button>
      ) : null}
      {canConnect && active.length >= 1 ? (
        // Disconnecting is destructive, so it sits in a menu, not beside Connect.
        <ActionMenu
          items={
            active.length === 1
              ? [
                  { label: "Manage", onSelect: onOpen },
                  {
                    danger: true,
                    label: "Disconnect",
                    onSelect: () => setDisconnecting(active[0] ?? null),
                  },
                ]
              : [{ label: "Manage", onSelect: onOpen }]
          }
          label={`Actions for ${app.display_name}`}
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
