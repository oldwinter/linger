import { useQuery } from "@tanstack/react-query";
import {
  Alert01Icon,
  ArrowUpRight01Icon,
  ComputerTerminal01Icon,
} from "@hugeicons/core-free-icons";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { createHerdrCoreClient, type HerdrCoreClient } from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import {
  isMachineConnected,
  terminalDisplayName,
  terminalStatusWord,
} from "./tree";
import type { HerdrCoreStatusResponse, HerdrCoreTerminal } from "./types";

export interface HerdrCoreCockpitCardProps {
  readonly computerId: string;
  readonly client?: HerdrCoreClient;
  readonly status?: HerdrCoreStatusResponse | null;
  readonly terminals?: readonly HerdrCoreTerminal[];
  readonly className?: string;
  readonly onOpenWorkbench?: () => void;
  readonly onSelectTerminal?: (address: string) => void;
}

/**
 * Compact, Variant-B-compatible Magpie Cockpit telemetry card summarizing
 * live/working/blocked/error terminals, online machines, and quick jumps to
 * blocked agents.
 */
export function HerdrCoreCockpitCard({
  computerId,
  client: providedClient,
  status: providedStatus,
  terminals: providedTerminals,
  className,
  onOpenWorkbench,
  onSelectTerminal,
}: HerdrCoreCockpitCardProps) {
  const t = useT();
  const client = useMemo(
    () => providedClient ?? createHerdrCoreClient({ computerId }),
    [computerId, providedClient],
  );

  const statusQuery = useQuery({
    queryKey: [
      "herdr-core",
      "cockpit-status",
      computerId,
      client.transportMode,
    ],
    queryFn: ({ signal }) => client.getStatus(signal),
    enabled: providedStatus === undefined && Boolean(computerId),
    retry: false,
    staleTime: 10_000,
  });

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
      (providedStatus?.available ?? statusQuery.data?.available ?? false),
    retry: false,
    staleTime: 10_000,
  });

  const status = providedStatus ?? statusQuery.data ?? null;
  const terminals = providedTerminals ?? terminalsQuery.data?.terminals ?? [];

  const blockedTerminals = terminals.filter(
    (term) => term.state === "live" && terminalStatusWord(term) === "blocked",
  );
  const errorCount = terminals.filter(
    (term) => term.state === "live" && terminalStatusWord(term) === "error",
  ).length;
  const liveCount = status?.live_count ?? terminals.length;
  const workingCount =
    status?.working_count ??
    terminals.filter(
      (term) => term.state === "live" && terminalStatusWord(term) === "working",
    ).length;
  const blockedCount = status?.blocked_count ?? blockedTerminals.length;

  const machines = status?.machines ?? [];
  const totalMachines = machines.length + (status?.available ? 1 : 0);
  const onlineMachines =
    machines.filter((entry) => isMachineConnected(entry)).length +
    (status?.available ? 1 : 0);

  return (
    <section
      aria-label={t(m.cockpitTitle)}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-outline",
        className,
      )}
      data-testid="herdr-core-cockpit-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
          >
            <Icon icon={ComputerTerminal01Icon} size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {t(m.cockpitTitle)}
            </h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {status?.available
                ? t(m.cockpitMachinesOnline, {
                    online: onlineMachines,
                    total: totalMachines,
                  })
                : t(m.cockpitOffline)}
            </p>
          </div>
        </div>
        {onOpenWorkbench ? (
          <Button onClick={onOpenWorkbench} size="compact" tone="ghost">
            <span>{t(m.cockpitOpenWorkbench)}</span>
            <Icon icon={ArrowUpRight01Icon} size={14} />
          </Button>
        ) : null}
      </div>

      {status?.available ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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
              label={t(m.cockpitErrorCount, { count: errorCount })}
              tone={errorCount > 0 ? "danger" : "neutral"}
            />
          </div>

          {blockedTerminals.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--app-status-warning-text)]">
                <Icon icon={Alert01Icon} size={12} />
                <span>{t(m.cockpitJumpBlocked)}</span>
              </div>
              <div className="flex flex-col gap-1">
                {blockedTerminals.slice(0, 3).map((term) => (
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={term.address}
                    onClick={() => onSelectTerminal?.(term.address)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {terminalDisplayName(term)}
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
          ) : null}
        </>
      ) : null}
    </section>
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
        "inline-flex items-center justify-center rounded-lg border px-2 py-1 text-xs font-medium tabular-nums",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}
