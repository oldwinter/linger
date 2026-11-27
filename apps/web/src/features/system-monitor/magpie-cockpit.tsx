import {
  domAnimation,
  LazyMotion,
  m as motionElem,
  useReducedMotion,
} from "motion/react";
import { useState } from "react";

import type { HerdrCoreClient } from "@/features/herdr-core/api";
import { HerdrCoreCockpitCard } from "@/features/herdr-core/herdr-core-cockpit-card";
import type { TeamHubApi } from "@/features/teamhub/teamhub-api";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { InferenceLedgerPanel } from "./inference-ledger-panel";
import { MemoryPoolPanel } from "./memory-pool-panel";
import { SiliconInspectorPanel } from "./silicon-inspector-panel";
import {
  formatInteger,
  formatMs,
  formatPercent,
  formatRate,
} from "./system-monitor-format";
import { systemMonitorMessages as m } from "./system-monitor.messages";
import type {
  SystemTelemetryBottleneck,
  SystemTelemetrySnapshot,
} from "./system-monitor-queries";

function bottleneckTone(
  severity: SystemTelemetryBottleneck["severity"],
): string {
  switch (severity) {
    case "healthy":
      return "text-app-success";
    case "warning":
      return "text-app-warning";
    case "critical":
      return "text-app-danger";
    default:
      return "text-muted-foreground";
  }
}

export interface MagpieCockpitProps {
  readonly snapshot: SystemTelemetrySnapshot;
  readonly computerId?: string;
  readonly isDesktopLocalComputer?: boolean;
  readonly teamHubApi?: TeamHubApi;
  readonly herdrCoreClient?: HerdrCoreClient;
  readonly onOpenHerdrWorkbench?: (address?: string) => void;
}

export function MagpieCockpit({
  snapshot,
  computerId,
  isDesktopLocalComputer = false,
  teamHubApi,
  herdrCoreClient,
  onOpenHerdrWorkbench,
}: MagpieCockpitProps) {
  const { language, t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [verbose, setVerbose] = useState(true);

  const { hardware, inference } = snapshot;
  const { bandwidth } = hardware;

  function bottleneckLabel(kind: SystemTelemetryBottleneck["kind"]): string {
    switch (kind) {
      case "idle":
        return t(m.bottleneckIdle);
      case "healthy":
        return t(m.bottleneckHealthy);
      case "memory_bw_bound":
        return t(m.bottleneckMemoryBwBound);
      case "kv_cache_bound":
        return t(m.bottleneckKvCacheBound);
      case "vram_pressure":
        return t(m.bottleneckVramPressure);
      case "thermal_throttled":
        return t(m.bottleneckThermalThrottled);
      case "prefill_compute_bound":
        return t(m.bottleneckPrefillComputeBound);
    }
  }

  const decodeSubline =
    inference.bandwidth_efficiency_pct != null
      ? t(m.ceilingAndPrefill, {
          pct: formatInteger(inference.bandwidth_efficiency_pct, language),
          prefill: formatRate(inference.prefill_tok_s, language),
        })
      : t(m.prefillOnly, {
          prefill: formatRate(inference.prefill_tok_s, language),
        });

  const ttftSubline =
    inference.ttft_p50_ms != null
      ? inference.prefix_cache_hit_rate_pct != null
        ? t(m.ttftP50AndHit, {
            hit: formatPercent(inference.prefix_cache_hit_rate_pct, language),
            p50: formatMs(inference.ttft_p50_ms, language),
          })
        : t(m.ttftP50Only, { p50: formatMs(inference.ttft_p50_ms, language) })
      : t(m.ttftIdle);

  const batchSubline =
    inference.kv_cache_used_pct != null
      ? t(m.activeAndKv, {
          active: formatInteger(inference.active_requests_count, language),
          kv: formatPercent(inference.kv_cache_used_pct, language),
        })
      : t(m.activeOnly, {
          active: formatInteger(inference.active_requests_count, language),
        });

  const hasEffectiveBandwidth =
    bandwidth.source === "estimated" && bandwidth.effective_decode_gb_s != null;
  const hasTheoreticalBandwidth =
    bandwidth.theoretical_gb_s != null && bandwidth.theoretical_gb_s > 0;

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-4" data-cockpit="magpie">
        {/* 1. Odometer Command Ribbon */}
        <section
          aria-label={t(m.ribbonRegion)}
          className="rounded-xl border border-border bg-card px-4 py-3 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-5">
              {/* Decode Speed */}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t(m.decodeSpeed)}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
                  {reducedMotion ? (
                    <span className="text-xl font-semibold tracking-tight text-foreground">
                      {formatRate(inference.decode_tok_s, language)}
                    </span>
                  ) : (
                    <motionElem.span
                      animate={{ opacity: 1, y: 0 }}
                      className="text-xl font-semibold tracking-tight text-foreground"
                      initial={{ opacity: 0.72, y: -2 }}
                      key={Math.round(inference.decode_tok_s * 2)}
                      transition={{ duration: 0.16 }}
                    >
                      {formatRate(inference.decode_tok_s, language)}
                    </motionElem.span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t(m.tokPerSec)}
                  </span>
                </div>
                <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {decodeSubline}
                </div>
              </div>

              {/* TTFT */}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t(m.ttftTitle)}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {formatMs(inference.ttft_live_ms, language)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    / {formatMs(inference.ttft_p95_ms, language)}
                  </span>
                </div>
                <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {ttftSubline}
                </div>
              </div>

              {/* In-Flight Batch */}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t(m.inFlightBatch)}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {inference.active_slots}/{inference.total_slots}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(m.slotsUnit)}
                  </span>
                  {inference.queued_requests_count > 0 ? (
                    <span className="rounded bg-app-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-app-warning">
                      {t(m.queuedBadge, {
                        count: inference.queued_requests_count,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {batchSubline}
                </div>
              </div>

              {/* Effective Memory Bandwidth */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span>{t(m.memoryBandwidth)}</span>
                  {hasEffectiveBandwidth ? (
                    <span
                      className="rounded bg-muted px-1 py-0.2 font-mono text-[10px] text-muted-foreground"
                      data-bandwidth-estimated=""
                    >
                      {t(m.bandwidthEstimatedBadge)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {hasEffectiveBandwidth
                      ? formatInteger(bandwidth.effective_decode_gb_s, language)
                      : t(m.unavailableValue)}
                  </span>
                  {hasTheoreticalBandwidth ? (
                    <span className="text-xs text-muted-foreground">
                      / {formatInteger(bandwidth.theoretical_gb_s, language)}{" "}
                      GB/s
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {hasEffectiveBandwidth &&
                  hasTheoreticalBandwidth &&
                  bandwidth.utilization_pct != null
                    ? t(m.bandwidthEstimatedNote, {
                        pct: formatInteger(bandwidth.utilization_pct, language),
                      })
                    : hasTheoreticalBandwidth
                      ? t(m.bandwidthIdleNote, {
                          peak: formatInteger(
                            bandwidth.theoretical_gb_s,
                            language,
                          ),
                        })
                      : t(m.bandwidthUnavailable)}
                </div>
              </div>

              {/* Session Odometer */}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t(m.sessionOdometer)}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {formatInteger(inference.total_tokens_session, language)}
                  </span>
                  <span className="font-sans text-xs text-muted-foreground">
                    {t(m.tokensUnit)}
                  </span>
                </div>
                <div
                  className={cn(
                    "truncate text-[11px] font-medium",
                    bottleneckTone(inference.bottleneck.severity),
                  )}
                  data-bottleneck-kind={inference.bottleneck.kind}
                >
                  {bottleneckLabel(inference.bottleneck.kind)}
                </div>
              </div>
            </div>

            {/* Compact / Verbose Switch */}
            <div className="flex shrink-0 items-center gap-2">
              <div
                aria-label={t(m.densityLabel)}
                className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5 text-xs"
                role="group"
              >
                <button
                  aria-pressed={!verbose}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors motion-reduce:transition-none",
                    !verbose
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setVerbose(false)}
                  type="button"
                >
                  {t(m.densityCompact)}
                </button>
                <button
                  aria-pressed={verbose}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors motion-reduce:transition-none",
                    verbose
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setVerbose(true)}
                  type="button"
                >
                  {t(m.densityVerbose)}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Tactile Memory Pool Ribbon */}
        <MemoryPoolPanel hardware={hardware} inference={inference} />

        {/* 3. Asymmetric Operational Ledger (7/5 Split) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <InferenceLedgerPanel inference={inference} />
          <SiliconInspectorPanel
            hardware={hardware}
            inference={inference}
            verbose={verbose}
          />
        </div>

        {/* 4. herdr-core Live Terminals & Agent Attention Telemetry */}
        {computerId ? (
          <HerdrCoreCockpitCard
            client={herdrCoreClient}
            computerId={computerId}
            density={verbose ? "verbose" : "compact"}
            isDesktopLocalComputer={isDesktopLocalComputer}
            onOpenWorkbench={
              onOpenHerdrWorkbench ? () => onOpenHerdrWorkbench() : undefined
            }
            onSelectTerminal={
              onOpenHerdrWorkbench
                ? (address) => onOpenHerdrWorkbench(address)
                : undefined
            }
            teamHubApi={teamHubApi}
          />
        ) : null}
      </div>
    </LazyMotion>
  );
}
