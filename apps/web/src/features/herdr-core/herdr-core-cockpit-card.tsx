import {
  Alert01Icon,
  ArrowUpRight01Icon,
  ComputerTerminal01Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
import {
  isMachineConnected,
  isMachineNeedsLogin,
  terminalDisplayName,
  terminalStatusWord,
} from "./tree";
import type {
  HerdrCoreMachine,
  HerdrCoreStatusResponse,
  HerdrCoreTerminal,
} from "./types";

export type HerdrCoreCockpitDensity = "compact" | "verbose";

export interface HerdrCoreCockpitCardProps {
  readonly computerId: string;
  readonly isDesktopLocalComputer?: boolean;
  readonly computerOnline?: boolean;
  readonly density?: HerdrCoreCockpitDensity;
  readonly client?: HerdrCoreClient;
  readonly teamHubApi?: TeamHubApi;
  readonly status?: HerdrCoreStatusResponse | null;
  readonly terminals?: readonly HerdrCoreTerminal[];
  readonly className?: string;
  readonly onOpenWorkbench?: () => void;
  readonly onSelectTerminal?: (address: string) => void;
}

function formatCoreIdentity(status: HerdrCoreStatusResponse): string | null {
  const version = status.version?.trim();
  const coreName = status.core_name?.trim();
  if (version && coreName) return `herdr-core ${version} · ${coreName}`;
  if (version) return `herdr-core ${version}`;
  return coreName || null;
}

function machineDotTone(machine: HerdrCoreMachine): string {
  if (isMachineConnected(machine)) return "bg-app-success";
  if (isMachineNeedsLogin(machine)) return "bg-app-warning";
  return "bg-muted-foreground";
}

/**
 * Variant-B-compatible Magpie Cockpit telemetry card summarizing `herdr-core`
 * daemon identity, online machines, live/working/blocked/error terminal
 * counters, and direct jumps to blocked agents or the live Terminal Workbench.
 */
export function HerdrCoreCockpitCard({
  computerId,
  isDesktopLocalComputer = false,
  computerOnline = true,
  density = "verbose",
  client: providedClient,
  teamHubApi,
  status: providedStatus,
  terminals: providedTerminals,
  className,
  onOpenWorkbench,
  onSelectTerminal,
}: HerdrCoreCockpitCardProps) {
  const t = useT();
  const isCompact = density === "compact";
  const desktopApi = useMemo(() => getDesktopHerdrCoreApi(), []);
  const shouldProbeDesktopBridge =
    isDesktopLocalComputer &&
    !providedClient &&
    providedStatus === undefined &&
    Boolean(desktopApi);

  const bridgeQuery = useQuery({
    queryKey: ["herdr-core", "desktop-bridge"],
    queryFn: () => desktopApi!.getBridge(),
    enabled: shouldProbeDesktopBridge,
    retry: false,
    staleTime: 30_000,
  });

  const directBridge = shouldProbeDesktopBridge
    ? (bridgeQuery.data ?? null)
    : null;
  const bridgeReady = !shouldProbeDesktopBridge || bridgeQuery.isFetched;

  const client = useMemo(
    () =>
      providedClient ??
      createHerdrCoreClient({
        computerId,
        directBridge,
        teamHubApi,
      }),
    [computerId, directBridge, providedClient, teamHubApi],
  );

  const canQueryRemote =
    computerOnline || client.transportMode === "desktop_direct";

  const statusQuery = useQuery({
    queryKey: [
      "herdr-core",
      "cockpit-status",
      computerId,
      client.transportMode,
    ],
    queryFn: ({ signal }) => client.getStatus(signal),
    enabled:
      providedStatus === undefined &&
      Boolean(computerId) &&
      bridgeReady &&
      canQueryRemote,
    retry: false,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.available ? 15_000 : false),
  });

  const resolvedStatus =
    providedStatus !== undefined ? providedStatus : (statusQuery.data ?? null);
  const isAvailable = Boolean(resolvedStatus?.available);

  const terminalsQuery = useQuery({
    queryKey: [
      "herdr-core",
      "cockpit-terminals",
      computerId,
      client.transportMode,
    ],
    queryFn: ({ signal }) => client.listTerminals({ all: false }, signal),
    enabled:
      providedTerminals === undefined &&
      Boolean(computerId) &&
      bridgeReady &&
      isAvailable,
    retry: false,
    staleTime: 10_000,
    refetchInterval: isAvailable ? 15_000 : false,
  });

  const terminals = providedTerminals ?? terminalsQuery.data?.terminals ?? [];
  const blockedTerminals = terminals.filter(
    (term) => term.state === "live" && terminalStatusWord(term) === "blocked",
  );
  const errorTerminals = terminals.filter(
    (term) => term.state === "live" && terminalStatusWord(term) === "error",
  );
  const liveCount = resolvedStatus?.live_count ?? terminals.length;
  const workingCount =
    resolvedStatus?.working_count ??
    terminals.filter(
      (term) => term.state === "live" && terminalStatusWord(term) === "working",
    ).length;
  const blockedCount = resolvedStatus?.blocked_count ?? blockedTerminals.length;
  const machines = resolvedStatus?.machines ?? [];
  const totalMachines = machines.length + (isAvailable ? 1 : 0);
  const onlineMachines =
    machines.filter((entry) => isMachineConnected(entry)).length +
    (isAvailable ? 1 : 0);

  const statusError =
    statusQuery.error instanceof HerdrCoreApiError ? statusQuery.error : null;
  const isChecking =
    providedStatus === undefined &&
    canQueryRemote &&
    (!bridgeReady || statusQuery.isPending);
  const isOffline =
    !isAvailable &&
    !isChecking &&
    (!computerOnline || statusError?.kind === "offline");
  const coreIdentity =
    resolvedStatus && isAvailable ? formatCoreIdentity(resolvedStatus) : null;

  const subtitleLabel = isAvailable
    ? t(m.cockpitMachinesOnline, {
        online: onlineMachines,
        total: totalMachines,
      })
    : isChecking
      ? t(m.cockpitChecking)
      : isOffline
        ? t(m.cockpitOffline)
        : t(m.cockpitUnavailable);

  return (
    <section
      aria-label={t(m.cockpitTitle)}
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card shadow-2xs",
        isCompact ? "gap-2.5 p-3" : "gap-3 p-4",
        className,
      )}
      data-cockpit-density={density}
      data-testid="herdr-core-cockpit-card"
      data-transport={client.transportMode}
    >
      <CockpitCardHeader
        blockedCount={blockedCount}
        coreIdentity={coreIdentity}
        isAvailable={isAvailable}
        isCompact={isCompact}
        onOpenWorkbench={onOpenWorkbench}
        subtitleLabel={subtitleLabel}
        transportMode={client.transportMode}
      />

      {isAvailable ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricPill
              label={t(m.cockpitLiveCount, { count: liveCount })}
              tone="neutral"
            />
            <MetricPill
              label={t(m.cockpitWorkingCount, { count: workingCount })}
              tone="info"
            />
            <MetricPill
              label={t(m.cockpitBlockedCount, { count: blockedCount })}
              tone={blockedCount > 0 ? "warning" : "neutral"}
            />
            <MetricPill
              label={t(m.cockpitErrorCount, { count: errorTerminals.length })}
              tone={errorTerminals.length > 0 ? "danger" : "neutral"}
            />
          </div>

          <CockpitBlockedSection
            blockedCount={blockedCount}
            blockedTerminals={blockedTerminals}
            isCompact={isCompact}
            onOpenWorkbench={onOpenWorkbench}
            onSelectTerminal={onSelectTerminal}
          />

          {!isCompact ? (
            <CockpitVerboseDetails
              coreName={resolvedStatus?.core_name}
              errorTerminals={errorTerminals}
              finishedCount={resolvedStatus?.finished_count}
              machines={machines}
              onOpenWorkbench={onOpenWorkbench}
              onSelectTerminal={onSelectTerminal}
            />
          ) : null}
        </>
      ) : !isChecking ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="herdr-core-degraded-note"
        >
          {isOffline ? t(m.cockpitOfflineHint) : t(m.cockpitUnavailableHint)}
        </p>
      ) : null}
    </section>
  );
}

function CockpitCardHeader({
  blockedCount,
  coreIdentity,
  isAvailable,
  isCompact,
  onOpenWorkbench,
  subtitleLabel,
  transportMode,
}: {
  readonly blockedCount: number;
  readonly coreIdentity: string | null;
  readonly isAvailable: boolean;
  readonly isCompact: boolean;
  readonly onOpenWorkbench?: () => void;
  readonly subtitleLabel: string;
  readonly transportMode: HerdrCoreClient["transportMode"];
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
        >
          <Icon icon={ComputerTerminal01Icon} size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t(m.cockpitTitle)}
            </h2>
            {isAvailable && blockedCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--app-status-warning-text)]"
                data-testid="herdr-core-blocked-badge"
              >
                <Icon icon={Alert01Icon} size={11} />
                {t(m.cockpitBlockedAttention, { count: blockedCount })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            {coreIdentity ? (
              <>
                <span
                  className="truncate font-mono text-[11px]"
                  data-testid="herdr-core-identity"
                >
                  {coreIdentity}
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="truncate">{subtitleLabel}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isCompact && isAvailable ? (
          <span
            className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex"
            data-testid="herdr-core-transport-badge"
          >
            {transportMode === "desktop_direct"
              ? t(m.transportDirect)
              : t(m.transportRelay)}
          </span>
        ) : null}
        {onOpenWorkbench ? (
          <Button
            onClick={onOpenWorkbench}
            size="compact"
            tone={blockedCount > 0 ? "primary" : "secondary"}
          >
            <span>{t(m.cockpitOpenWorkbench)}</span>
            <Icon icon={ArrowUpRight01Icon} size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CockpitBlockedSection({
  blockedCount,
  blockedTerminals,
  isCompact,
  onOpenWorkbench,
  onSelectTerminal,
}: {
  readonly blockedCount: number;
  readonly blockedTerminals: readonly HerdrCoreTerminal[];
  readonly isCompact: boolean;
  readonly onOpenWorkbench?: () => void;
  readonly onSelectTerminal?: (address: string) => void;
}) {
  const t = useT();
  const visibleBlocked = blockedTerminals.slice(0, isCompact ? 2 : 5);

  if (visibleBlocked.length > 0) {
    return (
      <div
        className="flex flex-col gap-1.5 border-t border-border pt-2.5"
        data-testid="herdr-core-blocked-list"
      >
        <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--app-status-warning-text)]">
          <Icon icon={Alert01Icon} size={12} />
          <span>{t(m.cockpitJumpBlocked)}</span>
        </div>
        <div className="flex flex-col gap-1">
          {visibleBlocked.map((term) => (
            <button
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              key={term.address}
              onClick={() =>
                onSelectTerminal
                  ? onSelectTerminal(term.address)
                  : onOpenWorkbench?.()
              }
              type="button"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">
                  {terminalDisplayName(term)}
                </span>
                {!isCompact ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {term.address}
                  </span>
                ) : null}
              </span>
              {term.status?.msg ? (
                <span className="max-w-[55%] truncate text-[11px] text-muted-foreground">
                  {term.status.msg}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (blockedCount > 0 && onOpenWorkbench) {
    return (
      <button
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-2.5 py-1.5 text-left text-xs font-medium text-[var(--app-status-warning-text)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={onOpenWorkbench}
        type="button"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={Alert01Icon} size={13} />
          {t(m.cockpitJumpBlocked)}
        </span>
        <Icon icon={ArrowUpRight01Icon} size={13} />
      </button>
    );
  }

  return null;
}

function CockpitVerboseDetails({
  coreName,
  errorTerminals,
  finishedCount,
  machines,
  onOpenWorkbench,
  onSelectTerminal,
}: {
  readonly coreName?: string | null;
  readonly errorTerminals: readonly HerdrCoreTerminal[];
  readonly finishedCount?: number;
  readonly machines: readonly HerdrCoreMachine[];
  readonly onOpenWorkbench?: () => void;
  readonly onSelectTerminal?: (address: string) => void;
}) {
  const t = useT();
  return (
    <div
      className="space-y-2 rounded-xl border border-border bg-background/60 p-2.5 text-[11px] tabular-nums"
      data-cockpit-herdr-verbose=""
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">
            {t(m.cockpitMachinesLabel)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-app-success"
            />
            {coreName || t(m.localMachine)}
          </span>
          {machines.map((machine) => (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-foreground"
              key={machine.name}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", machineDotTone(machine))}
              />
              <span>{machine.name}</span>
              {!isMachineConnected(machine) ? (
                <span className="text-[10px] text-muted-foreground">
                  (
                  {isMachineNeedsLogin(machine)
                    ? t(m.machineNeedsLogin)
                    : t(m.machineOffline)}
                  )
                </span>
              ) : null}
            </span>
          ))}
        </div>
        {typeof finishedCount === "number" ? (
          <span className="font-mono text-muted-foreground">
            {t(m.cockpitFinishedCount, { count: finishedCount })}
          </span>
        ) : null}
      </div>

      {errorTerminals.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
          <span className="font-medium text-[var(--app-status-danger-text)]">
            {t(m.cockpitJumpErrors)}:
          </span>
          {errorTerminals.slice(0, 3).map((term) => (
            <button
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-status-danger-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              key={term.address}
              onClick={() =>
                onSelectTerminal
                  ? onSelectTerminal(term.address)
                  : onOpenWorkbench?.()
              }
              type="button"
            >
              <span className="truncate">{terminalDisplayName(term)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricPill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: "neutral" | "info" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] text-[var(--app-status-warning-text)]"
      : tone === "danger"
        ? "border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] text-[var(--app-status-danger-text)]"
        : tone === "info"
          ? "border-[var(--app-card-info-border)] bg-[var(--app-card-info-surface)] text-[var(--app-card-info-text)]"
          : "border-border bg-muted/50 text-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg border px-2 py-1.5 text-xs font-medium tabular-nums",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}
