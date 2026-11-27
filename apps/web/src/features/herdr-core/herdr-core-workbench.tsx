import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ClipboardCopyIcon,
  ComputerTerminal01Icon,
  FlashIcon,
  Folder01Icon,
  Layers01Icon,
  RefreshIcon,
  Tick02Icon,
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
import { Skeleton } from "@/components/ui/skeleton";
import type { TeamHubApi } from "@/features/teamhub/teamhub-api";
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
  terminalCurrentCwd,
  terminalDisplayName,
  terminalStatusWord,
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
const START_COMMAND = "hc server start";

export interface HerdrCoreWorkbenchProps {
  readonly computerId: string;
  readonly isDesktopLocalComputer?: boolean;
  readonly embedded?: boolean;
  readonly roomId?: string;
  readonly defaultWorkItemId?: string;
  readonly initialAddress?: string;
  readonly client?: HerdrCoreClient;
  readonly teamHubApi?: TeamHubApi;
  readonly className?: string;
}

export function HerdrCoreWorkbench({
  computerId,
  isDesktopLocalComputer = false,
  embedded = false,
  roomId,
  defaultWorkItemId = "",
  initialAddress,
  client: providedClient,
  teamHubApi,
  className,
}: HerdrCoreWorkbenchProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const desktopApi = useMemo(() => getDesktopHerdrCoreApi(), []);
  const [desktopBridge, setDesktopBridge] =
    useState<DesktopHerdrCoreBridgeInfo | null>(null);
  const [startingLocalCore, setStartingLocalCore] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copiedStartCmd, setCopiedStartCmd] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

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
        teamHubApi,
      }),
    [
      computerId,
      desktopBridge,
      isDesktopLocalComputer,
      providedClient,
      teamHubApi,
    ],
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
  // Narrow container (<720px) switches cleanly between list and detail panes.
  const [narrowPane, setNarrowPane] = useState<"list" | "detail">(
    initialAddress ? "detail" : "list",
  );
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [syncingAddress, setSyncingAddress] = useState<string | null>(null);
  const [quickKeyBusyAddress, setQuickKeyBusyAddress] = useState<string | null>(
    null,
  );

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

  const blockedCount = useMemo(
    () =>
      allTerminals.filter(
        (term) =>
          term.state === "live" && terminalStatusWord(term) === "blocked",
      ).length,
    [allTerminals],
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
      // If user launched outside current Room filter, broaden filter so the new terminal is visible immediately.
      if (roomId && filters.roomOnly && !request.labels?.["linger.room"]) {
        setFilters((prev) => ({ ...prev, roomOnly: false }));
      }
      if (created.terminal?.address) {
        setSelectedAddress(created.terminal.address);
        setNarrowPane("detail");
      }
      refreshAll();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  }

  async function handleQuickKeys(
    terminal: HerdrCoreTerminal,
    keys: readonly string[],
  ) {
    if (quickKeyBusyAddress !== null) return;
    setQuickKeyBusyAddress(terminal.address);
    try {
      await client.sendKeys({ address: terminal.address, keys });
      refreshAll();
    } finally {
      setQuickKeyBusyAddress(null);
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
      if (client.transportMode === "desktop_direct") {
        await client
          .labelTerminal(terminal.address, adoption.labels)
          .catch(() => undefined);
      }
      await herdrAppDocQuery.refetch();
      refreshAll();
    } finally {
      setSyncingAddress(null);
    }
  }

  function copyStartCommand() {
    void navigator.clipboard?.writeText(START_COMMAND).then(() => {
      setCopiedStartCmd(true);
      window.setTimeout(() => setCopiedStartCmd(false), 1_500);
    });
  }

  function copySelectedAddress() {
    if (!selectedTerminal) return;
    void navigator.clipboard?.writeText(selectedTerminal.address).then(() => {
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 1_500);
    });
  }

  const statusError =
    statusQuery.error instanceof HerdrCoreApiError ? statusQuery.error : null;

  const selectedCwd = selectedTerminal
    ? terminalCurrentCwd(selectedTerminal)
    : "";
  const selectedSpace = selectedTerminal
    ? (selectedTerminal.labels["herdr.space"] ??
      herdrAppDoc.spaces.find((s) =>
        s.tabs.some((tab) => tab.terminal === selectedTerminal.address),
      )?.name ??
      null)
    : null;
  const selectedWorkItem = selectedTerminal?.labels["linger.work_item"]?.trim();
  const selectedRoom = selectedTerminal?.labels["linger.room"]?.trim();

  return (
    <div
      className={cn(
        "@container flex h-full min-h-0 w-full min-w-0 flex-col bg-card text-foreground",
        className,
      )}
      data-testid="herdr-core-workbench"
      data-transport={client.transportMode}
    >
      {/* Top workbench header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {!embedded ? (
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
            >
              <Icon icon={ComputerTerminal01Icon} size={15} />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {!embedded ? (
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {t(m.workbenchTitle)}
                </h2>
              ) : null}
              {statusQuery.data?.version ? (
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  herdr-core {statusQuery.data.version}
                  {statusQuery.data.core_name
                    ? ` · ${statusQuery.data.core_name}`
                    : ""}
                </span>
              ) : null}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {client.transportMode === "desktop_direct"
                  ? t(m.transportDirect)
                  : t(m.transportRelay)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isAvailable && narrowPane === "detail" ? (
            <Button
              className="@[720px]:hidden"
              onClick={() => setNarrowPane("list")}
              size="compact"
              tone="secondary"
            >
              <Icon icon={ArrowLeft01Icon} size={13} />
              <span>{t(m.backToList)}</span>
              {blockedCount > 0 ? (
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--app-status-warning-text)] text-[10px] font-semibold text-background tabular-nums">
                  {blockedCount}
                </span>
              ) : null}
            </Button>
          ) : null}
          <Button
            aria-label={t(m.refresh)}
            loading={statusQuery.isFetching || terminalsQuery.isFetching}
            onClick={refreshAll}
            size="compactIcon"
            title={t(m.refresh)}
            tone="ghost"
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

      {/* Initial loading skeleton (zero layout jump) */}
      {statusQuery.isLoading ? (
        <div
          aria-busy="true"
          aria-label={t(m.loadingWorkbench)}
          className="flex min-h-0 flex-1 flex-col gap-3 p-3 @[720px]:flex-row"
          role="status"
        >
          <div className="flex flex-col gap-2 @[720px]:w-68 @[720px]:shrink-0">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-48 flex-1 rounded-lg" />
          </div>
        </div>
      ) : !isAvailable ? (
        /* Unavailable / offline / not-implemented degradation states */
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
          {statusError?.kind !== "not_implemented" &&
          statusError?.kind !== "offline" ? (
            <div className="flex flex-col items-center gap-2">
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
              <p className="text-[11px] text-muted-foreground">
                {t(m.startCommandHint)}
              </p>
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                <code className="font-mono text-xs text-foreground">
                  {START_COMMAND}
                </code>
                <Button
                  aria-label={t(m.copyCommand)}
                  onClick={copyStartCommand}
                  size="compact"
                  tone="secondary"
                >
                  <Icon
                    icon={copiedStartCmd ? Tick02Icon : ClipboardCopyIcon}
                    size={12}
                  />
                  <span>{copiedStartCmd ? t(m.copied) : t(m.copyCommand)}</span>
                </Button>
              </div>
            </div>
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
        <div className="flex min-h-0 flex-1 flex-col @[720px]:flex-row">
          {/* Sidebar list: full-width pane on <720px containers, fixed 272px column on >=720px */}
          <aside
            aria-label={t(m.toggleSidebar)}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col p-2.5 @[720px]:flex @[720px]:w-72 @[720px]:flex-none @[720px]:shrink-0 @[720px]:border-r @[720px]:border-border",
              narrowPane === "list" ? "flex" : "hidden",
            )}
          >
            <TerminalSidebarList
              allTerminals={allTerminals}
              filters={filters}
              groupBySpace={groupBySpace}
              herdrAppDoc={herdrAppDoc}
              machines={machines}
              onFiltersChange={(patch) =>
                setFilters((prev) => ({ ...prev, ...patch }))
              }
              onGroupBySpaceChange={setGroupBySpace}
              onQuickKeys={handleQuickKeys}
              onSelect={(address) => {
                setSelectedAddress(address);
                setNarrowPane("detail");
              }}
              onSyncToSpace={handleSyncToSpace}
              quickKeyBusyAddress={quickKeyBusyAddress}
              roomId={roomId}
              selectedAddress={activeAddress}
              syncingAddress={syncingAddress}
              terminals={filteredTerminals}
            />
          </aside>

          {/* Main terminal inspection & interactive pane */}
          <section
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col gap-2 p-2.5 @[720px]:flex",
              narrowPane === "detail" ? "flex" : "hidden",
            )}
          >
            {selectedTerminal ? (
              <>
                <div className="flex flex-col gap-1.5 border-b border-border pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {terminalDisplayName(selectedTerminal)}
                      </h3>
                      <button
                        aria-label={
                          copiedAddress
                            ? t(m.addressCopied, {
                                address: selectedTerminal.address,
                              })
                            : t(m.copyAddress, {
                                address: selectedTerminal.address,
                              })
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="herdr-copy-address"
                        onClick={copySelectedAddress}
                        title={t(m.copyAddress, {
                          address: selectedTerminal.address,
                        })}
                        type="button"
                      >
                        <span>{selectedTerminal.address}</span>
                        <Icon
                          icon={copiedAddress ? Tick02Icon : ClipboardCopyIcon}
                          size={11}
                        />
                      </button>
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

                  <HerdrCoreStatusPill terminal={selectedTerminal} />

                  {/* Compact live metadata ribbon */}
                  {selectedCwd ||
                  selectedTerminal.template ||
                  selectedWorkItem ||
                  selectedRoom ||
                  selectedSpace ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {selectedTerminal.template ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                          {selectedTerminal.template}
                        </span>
                      ) : null}
                      {selectedWorkItem ? (
                        <span className="rounded bg-[var(--app-card-info-surface)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--app-card-info-text)]">
                          {selectedWorkItem}
                        </span>
                      ) : null}
                      {selectedSpace ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                          <Icon icon={Layers01Icon} size={10} />
                          <span>{selectedSpace}</span>
                        </span>
                      ) : null}
                      {selectedCwd ? (
                        <span
                          className="inline-flex min-w-0 max-w-full items-center gap-1 truncate font-mono text-[10px]"
                          title={selectedCwd}
                        >
                          <Icon
                            className="shrink-0"
                            icon={Folder01Icon}
                            size={11}
                          />
                          <span className="truncate">{selectedCwd}</span>
                        </span>
                      ) : null}
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
                      key={selectedTerminal.address}
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
                    key={selectedTerminal.address}
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
          defaultCwd={selectedCwd}
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
