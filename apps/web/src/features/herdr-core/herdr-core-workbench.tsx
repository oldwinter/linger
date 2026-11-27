import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  ComputerTerminal01Icon,
  FlashIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import {
  createHerdrCoreClient,
  getDesktopHerdrCoreApi,
  HerdrCoreApiError,
  type HerdrCoreClient,
} from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import { LaunchTerminalDialog } from "./launch-terminal-dialog";
import { HerdrCoreStatusPill } from "./status-pill";
import { TerminalLightView } from "./terminal-light-view";
import { TerminalSidebarList } from "./terminal-sidebar-list";
import {
  buildHerdrAppAdoption,
  buildTerminalTree,
  filterTerminals,
  flattenTerminalTree,
  parseHerdrAppDoc,
  terminalDisplayName,
  type TerminalFilterCriteria,
} from "./tree";
import type {
  DesktopHerdrCoreBridgeInfo,
  HerdrCoreLaunchRequest,
  HerdrCoreTerminal,
} from "./types";

// Strictly lazy-loaded so Light Mode and initial Room renders never download xterm.
const LazyXtermView = lazy(() =>
  import("./lazy-xterm-view").then((module) => ({
    default: module.LazyXtermView,
  })),
);

const EMPTY_TERMINALS: readonly HerdrCoreTerminal[] = [];

export interface HerdrCoreWorkbenchProps {
  readonly computerId: string;
  readonly isDesktopLocalComputer?: boolean;
  readonly roomId?: string;
  readonly defaultWorkItemId?: string;
  readonly initialAddress?: string;
  readonly client?: HerdrCoreClient;
  readonly className?: string;
}

export function HerdrCoreWorkbench({
  computerId,
  isDesktopLocalComputer = false,
  roomId,
  defaultWorkItemId = "",
  initialAddress,
  client: providedClient,
  className,
}: HerdrCoreWorkbenchProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const desktopApi = useMemo(() => getDesktopHerdrCoreApi(), []);
  const [desktopBridge, setDesktopBridge] =
    useState<DesktopHerdrCoreBridgeInfo | null>(null);
  const [startingLocalCore, setStartingLocalCore] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopLocalComputer || !desktopApi || providedClient) {
      setDesktopBridge(null);
      return;
    }
    let active = true;
    void desktopApi
      .getBridge()
      .then((info) => {
        if (active) setDesktopBridge(info);
      })
      .catch(() => {
        if (active) setDesktopBridge(null);
      });
    return () => {
      active = false;
    };
  }, [desktopApi, isDesktopLocalComputer, providedClient]);

  const client = useMemo(
    () =>
      providedClient ??
      createHerdrCoreClient({
        computerId,
        directBridge: isDesktopLocalComputer ? desktopBridge : null,
      }),
    [computerId, desktopBridge, isDesktopLocalComputer, providedClient],
  );

  const [filters, setFilters] = useState<TerminalFilterCriteria>({
    machine: "all",
    roomId,
    roomOnly: Boolean(roomId),
    workItemId: defaultWorkItemId,
    status: "all",
    search: "",
    showFinished: false,
  });
  const [groupBySpace, setGroupBySpace] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    initialAddress ?? null,
  );
  const [viewMode, setViewMode] = useState<"light" | "interactive">("light");
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [syncingAddress, setSyncingAddress] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["herdr-core", "status", computerId, client.transportMode],
    queryFn: ({ signal }) => client.getStatus(signal),
    retry: false,
    refetchInterval: 10_000,
  });

  const isAvailable = Boolean(statusQuery.data?.available);

  const terminalsQuery = useQuery({
    queryKey: [
      "herdr-core",
      "terminals",
      computerId,
      client.transportMode,
      filters.showFinished,
    ],
    queryFn: ({ signal }) =>
      client.listTerminals({ all: filters.showFinished }, signal),
    enabled: isAvailable,
    retry: false,
    refetchInterval: 5_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["herdr-core", "templates", computerId, client.transportMode],
    queryFn: ({ signal }) => client.listTemplates(signal),
    enabled: isAvailable && launchOpen,
    retry: false,
  });

  const herdrAppDocQuery = useQuery({
    queryKey: [
      "herdr-core",
      "doc",
      "herdr-app",
      computerId,
      client.transportMode,
    ],
    queryFn: ({ signal }) => client.getDoc("herdr-app", undefined, signal),
    enabled: isAvailable,
    retry: false,
    staleTime: 30_000,
  });

  const herdrAppDoc = useMemo(
    () => parseHerdrAppDoc(herdrAppDocQuery.data?.value),
    [herdrAppDocQuery.data?.value],
  );

  const allTerminals = terminalsQuery.data?.terminals ?? EMPTY_TERMINALS;
  const machines =
    terminalsQuery.data?.machines ?? statusQuery.data?.machines ?? [];

  const filteredTerminals = useMemo(
    () => filterTerminals(allTerminals, { ...filters, roomId }),
    [allTerminals, filters, roomId],
  );

  const orderedFlat = useMemo(
    () => flattenTerminalTree(buildTerminalTree(filteredTerminals)),
    [filteredTerminals],
  );

  const activeAddress =
    selectedAddress &&
    allTerminals.some((term) => term.address === selectedAddress)
      ? selectedAddress
      : (orderedFlat[0]?.terminal.address ?? null);

  const selectedTerminal = activeAddress
    ? (allTerminals.find((term) => term.address === activeAddress) ?? null)
    : null;

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["herdr-core", "status", computerId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["herdr-core", "terminals", computerId],
    });
  }, [computerId, queryClient]);

  async function handleStartLocalCore() {
    if (!desktopApi) return;
    setStartingLocalCore(true);
    setStartError(null);
    try {
      const result = await desktopApi.startServer();
      if (!result.ok && result.error) {
        setStartError(result.error);
      }
      const nextBridge = await desktopApi.getBridge();
      setDesktopBridge(nextBridge);
      refreshAll();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingLocalCore(false);
    }
  }

  async function handleLaunch(request: HerdrCoreLaunchRequest) {
    setLaunching(true);
    setLaunchError(null);
    try {
      const created = await client.launchTerminal(request);
      setLaunchOpen(false);
      if (created.terminal?.address) {
        setSelectedAddress(created.terminal.address);
        setMobileListOpen(false);
      }
      refreshAll();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  }

  async function handleSyncToSpace(
    terminal: HerdrCoreTerminal,
    spaceName: string,
  ) {
    setSyncingAddress(terminal.address);
    try {
      const adoption = buildHerdrAppAdoption({
        doc: herdrAppDoc,
        terminal,
        spaceName,
      });
      await client.putDoc("herdr-app", adoption.nextDocValue, {
        version: herdrAppDocQuery.data?.version ?? 0,
      });
      // Best-effort label sync (if Track 2 relay exposes /terminal/label or direct bridge is active).
      await client
        .labelTerminal(terminal.address, adoption.labels)
        .catch(() => undefined);
      await herdrAppDocQuery.refetch();
      refreshAll();
    } finally {
      setSyncingAddress(null);
    }
  }

  const statusError =
    statusQuery.error instanceof HerdrCoreApiError ? statusQuery.error : null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col bg-card text-foreground",
        className,
      )}
      data-testid="herdr-core-workbench"
      data-transport={client.transportMode}
    >
      {/* Top workbench header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
          >
            <Icon icon={ComputerTerminal01Icon} size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {t(m.workbenchTitle)}
              </h2>
              <span className="hidden rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                {client.transportMode === "desktop_direct"
                  ? t(m.transportDirect)
                  : t(m.transportRelay)}
              </span>
            </div>
            {statusQuery.data?.version ? (
              <p className="truncate text-[11px] text-muted-foreground">
                herdr-core {statusQuery.data.version}
                {statusQuery.data.core_name
                  ? ` · ${statusQuery.data.core_name}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            className="sm:hidden"
            onClick={() => setMobileListOpen((v) => !v)}
            size="compact"
            tone="secondary"
          >
            {t(m.toggleSidebar)}
          </Button>
          <Button
            loading={statusQuery.isFetching || terminalsQuery.isFetching}
            onClick={refreshAll}
            size="compactIcon"
            title={t(m.refresh)}
            tone="ghost"
            aria-label={t(m.refresh)}
          >
            <Icon icon={RefreshIcon} size={14} />
          </Button>
          {isAvailable ? (
            <Button
              onClick={() => {
                setLaunchError(null);
                setLaunchOpen(true);
              }}
              size="compact"
              tone="primary"
            >
              <Icon icon={Add01Icon} size={14} />
              <span>{t(m.launchTerminal)}</span>
            </Button>
          ) : null}
        </div>
      </header>

      {/* Unavailable / offline / not-implemented degradation states */}
      {!statusQuery.isLoading && !isAvailable ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"
          >
            <Icon icon={ComputerTerminal01Icon} size={22} />
          </span>
          <div className="max-w-sm">
            <h3 className="text-sm font-semibold text-foreground">
              {statusError?.kind === "not_implemented"
                ? t(m.notImplementedTitle)
                : statusError?.kind === "offline"
                  ? t(m.offlineTitle)
                  : t(m.unavailableTitle)}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusError?.kind === "not_implemented"
                ? t(m.notImplementedBody)
                : statusError?.kind === "offline"
                  ? t(m.offlineBody)
                  : desktopBridge?.detection.installHint ||
                    t(m.unavailableBody)}
            </p>
          </div>
          {isDesktopLocalComputer && desktopApi ? (
            <Button
              data-voice-risk="confirm"
              loading={startingLocalCore}
              onClick={() => void handleStartLocalCore()}
              tone="primary"
            >
              <Icon icon={FlashIcon} size={14} />
              <span>
                {startingLocalCore
                  ? t(m.startingLocalCore)
                  : t(m.startLocalCore)}
              </span>
            </Button>
          ) : null}
          {startError ? (
            <p
              className="max-w-sm text-xs text-[var(--app-status-danger-text)]"
              role="alert"
            >
              {startError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Sidebar list (responsive drawer/toggle on <640px) */}
          <aside
            aria-label={t(m.toggleSidebar)}
            className={cn(
              "min-h-0 w-full flex-col border-b border-border p-2.5 sm:flex sm:w-64 sm:shrink-0 sm:border-r sm:border-b-0",
              mobileListOpen ? "flex max-h-[45%] sm:max-h-none" : "hidden",
            )}
          >
            <TerminalSidebarList
              filters={filters}
              groupBySpace={groupBySpace}
              herdrAppDoc={herdrAppDoc}
              machines={machines}
              onFiltersChange={(patch) =>
                setFilters((prev) => ({ ...prev, ...patch }))
              }
              onGroupBySpaceChange={setGroupBySpace}
              onSelect={(address) => {
                setSelectedAddress(address);
                setMobileListOpen(false);
              }}
              onSyncToSpace={handleSyncToSpace}
              roomId={roomId}
              selectedAddress={activeAddress}
              syncingAddress={syncingAddress}
              terminals={filteredTerminals}
            />
          </aside>

          {/* Main terminal inspection & interactive pane */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2.5">
            {selectedTerminal ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {terminalDisplayName(selectedTerminal)}
                      </h3>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {selectedTerminal.address}
                      </span>
                    </div>
                    <div className="mt-1">
                      <HerdrCoreStatusPill terminal={selectedTerminal} />
                    </div>
                  </div>

                  {selectedTerminal.state === "live" ? (
                    <div
                      className="inline-flex shrink-0 rounded-lg border border-border bg-muted/50 p-0.5"
                      role="group"
                    >
                      <button
                        aria-pressed={viewMode === "light"}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          viewMode === "light"
                            ? "bg-card text-foreground shadow-outline"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setViewMode("light")}
                        type="button"
                      >
                        {t(m.lightMode)}
                      </button>
                      <button
                        aria-pressed={viewMode === "interactive"}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          viewMode === "interactive"
                            ? "bg-card text-foreground shadow-outline"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setViewMode("interactive")}
                        type="button"
                      >
                        {t(m.interactiveMode)}
                      </button>
                    </div>
                  ) : null}
                </div>

                {viewMode === "interactive" &&
                selectedTerminal.state === "live" ? (
                  <Suspense
                    fallback={
                      <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
                        {t(m.connectingPty)}
                      </div>
                    }
                  >
                    <LazyXtermView
                      address={selectedTerminal.address}
                      client={client}
                      initialCols={selectedTerminal.cols || 100}
                      initialRows={selectedTerminal.rows || 30}
                      onStatusMessage={(msg) => {
                        if (msg.type === "status" || msg.type === "closed") {
                          refreshAll();
                        }
                      }}
                    />
                  </Suspense>
                ) : (
                  <TerminalLightView
                    client={client}
                    onRefreshList={refreshAll}
                    terminal={selectedTerminal}
                  />
                )}
              </>
            ) : (
              <div className="grid flex-1 place-items-center px-4 text-center text-xs text-muted-foreground">
                {t(m.selectTerminalPrompt)}
              </div>
            )}
          </section>
        </div>
      )}

      {launchOpen ? (
        <LaunchTerminalDialog
          defaultMachine={filters.machine}
          defaultRoomId={roomId}
          defaultWorkItemId={filters.workItemId}
          error={launchError}
          machines={machines}
          onClose={() => setLaunchOpen(false)}
          onLaunch={handleLaunch}
          pending={launching}
          templates={templatesQuery.data?.templates ?? []}
        />
      ) : null}
    </div>
  );
}
