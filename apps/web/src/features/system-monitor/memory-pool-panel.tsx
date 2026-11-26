import { useState } from "react";

import type { Language, Translate } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import {
  clampPct,
  formatGiB,
  formatInteger,
  formatTokenCapacity,
} from "./system-monitor-format";
import { systemMonitorMessages as m } from "./system-monitor.messages";
import type {
  SystemTelemetryHardware,
  SystemTelemetryInference,
  SystemTelemetryMemory,
} from "./system-monitor-queries";

interface MemorySegment {
  readonly id: string;
  readonly label: string;
  readonly bytes: number;
  readonly colorVar: string;
  readonly note: string;
  readonly hatch?: "free" | "compressed";
}

function pressureToneClass(
  pressure: SystemTelemetryMemory["memory_pressure"],
): string {
  switch (pressure) {
    case "normal":
      return "bg-app-success/15 text-app-success";
    case "warning":
      return "bg-app-warning/15 text-app-warning";
    case "critical":
      return "bg-app-danger/15 text-app-danger";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function buildMemorySegments(
  memory: SystemTelemetryMemory,
  isUma: boolean,
  primaryTotal: number,
  primaryUsed: number,
  kvNote: string,
  t: Translate,
): MemorySegment[] {
  if (isUma) {
    return [
      {
        id: "weights",
        label: t(m.segmentWeights),
        bytes: memory.model_weights_bytes,
        colorVar: "var(--telemetry-weights)",
        note: t(m.segmentWeightsNote),
      },
      {
        id: "kv",
        label: t(m.segmentKv),
        bytes: memory.kv_cache_bytes,
        colorVar: "var(--telemetry-kv)",
        note: kvNote,
      },
      {
        id: "compute",
        label: t(m.segmentCompute),
        bytes: memory.compute_buffer_bytes,
        colorVar: "var(--telemetry-compute)",
        note: t(m.segmentComputeNote),
      },
      {
        id: "wired",
        label: t(m.segmentWired),
        bytes: memory.os_wired_bytes,
        colorVar: "var(--telemetry-wired)",
        note: t(m.segmentWiredNote),
      },
      {
        id: "apps",
        label: t(m.segmentApps),
        bytes: memory.active_apps_bytes,
        colorVar: "var(--telemetry-apps)",
        note: t(m.segmentAppsNote),
      },
      {
        id: "compressed",
        label: t(m.segmentCompressed),
        bytes: memory.compressed_bytes,
        colorVar: "var(--telemetry-compressed)",
        note: t(m.segmentCompressedNote),
        hatch: "compressed",
      },
      {
        id: "free",
        label: t(m.segmentFree),
        bytes: memory.free_headroom_bytes,
        colorVar: "var(--telemetry-free)",
        note: t(m.segmentFreeNote),
        hatch: "free",
      },
    ];
  }

  const modelTotal =
    memory.model_weights_bytes +
    memory.kv_cache_bytes +
    memory.compute_buffer_bytes;
  const otherGpu = Math.max(0, primaryUsed - modelTotal);
  const freeVram =
    memory.vram_free_bytes ?? Math.max(0, primaryTotal - primaryUsed);

  return [
    {
      id: "weights",
      label: t(m.segmentWeights),
      bytes: memory.model_weights_bytes,
      colorVar: "var(--telemetry-weights)",
      note: t(m.segmentWeightsNote),
    },
    {
      id: "kv",
      label: t(m.segmentKv),
      bytes: memory.kv_cache_bytes,
      colorVar: "var(--telemetry-kv)",
      note: kvNote,
    },
    {
      id: "compute",
      label: t(m.segmentCompute),
      bytes: memory.compute_buffer_bytes,
      colorVar: "var(--telemetry-compute)",
      note: t(m.segmentComputeNote),
    },
    {
      id: "other-gpu",
      label: t(m.segmentOtherGpu),
      bytes: otherGpu,
      colorVar: "var(--telemetry-apps)",
      note: t(m.segmentOtherGpuNote),
    },
    {
      id: "free",
      label: t(m.segmentFreeVram),
      bytes: freeVram,
      colorVar: "var(--telemetry-free)",
      note: t(m.segmentFreeVramNote),
      hatch: "free",
    },
  ];
}

export function MemoryPoolPanel({
  hardware,
  inference,
}: {
  readonly hardware: SystemTelemetryHardware;
  readonly inference: SystemTelemetryInference;
}) {
  const { language, t } = useTranslation();
  const [activeSegmentId, setActiveSegmentId] = useState<string>("weights");

  const { memory } = hardware;
  const isUma = hardware.architecture === "uma";
  const primaryTotal = isUma
    ? memory.total_bytes
    : (memory.vram_total_bytes ?? memory.total_bytes);
  const primaryUsed = isUma
    ? memory.used_bytes
    : (memory.vram_used_bytes ?? memory.used_bytes);

  const kvNote =
    inference.kv_cache_tokens_capacity > 0 &&
    inference.kv_cache_used_pct != null
      ? t(m.segmentKvNote, {
          capacity: formatTokenCapacity(inference.kv_cache_tokens_capacity),
          pct: formatInteger(inference.kv_cache_used_pct, language),
        })
      : t(m.segmentKvNoteSimple);

  const segments = buildMemorySegments(
    memory,
    isUma,
    primaryTotal,
    primaryUsed,
    kvNote,
    t,
  );
  const selectedSegment =
    segments.find((segment) => segment.id === activeSegmentId) ?? segments[0]!;

  const workingSetPct =
    isUma && memory.recommended_working_set_bytes && primaryTotal > 0
      ? Math.min(
          99,
          Math.round(
            (memory.recommended_working_set_bytes / primaryTotal) * 100,
          ),
        )
      : null;

  const pressureLabel =
    memory.memory_pressure === "normal"
      ? t(m.pressureNormal)
      : memory.memory_pressure === "warning"
        ? t(m.pressureWarning)
        : memory.memory_pressure === "critical"
          ? t(m.pressureCritical)
          : null;

  const swapText =
    memory.swap_used_bytes != null
      ? memory.swap_io_mb_s != null
        ? t(m.swapSummary, {
            io: formatInteger(memory.swap_io_mb_s, language),
            used: formatGiB(memory.swap_used_bytes, language),
          })
        : t(m.swapUsedOnly, {
            used: formatGiB(memory.swap_used_bytes, language),
          })
      : null;

  return (
    <section
      aria-label={t(m.memoryRegion)}
      className="rounded-xl border border-border bg-card p-4"
      data-memory-architecture={hardware.architecture}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isUma ? t(m.unifiedMemoryTitle) : t(m.discreteVramTitle)}
          </h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t(m.memoryUsedOfTotal, {
              total: formatGiB(primaryTotal, language),
              used: formatGiB(primaryUsed, language),
            })}
            {isUma && memory.recommended_working_set_bytes
              ? ` · ${t(m.memoryWorkingSetSummary, {
                  size: formatGiB(
                    memory.recommended_working_set_bytes,
                    language,
                  ),
                })}`
              : ""}
            {isUma
              ? ` · ${t(m.memorySystemRamFree, {
                  free: formatGiB(memory.system_ram_available_bytes, language),
                })}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {pressureLabel ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                pressureToneClass(memory.memory_pressure),
              )}
            >
              {t(m.pressureLabel, { level: pressureLabel })}
            </span>
          ) : null}
          {swapText ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {swapText}
            </span>
          ) : null}
        </div>
      </div>

      <MemoryAllocationBar
        language={language}
        onSelect={setActiveSegmentId}
        primaryTotal={primaryTotal}
        segments={segments}
        selectedSegment={selectedSegment}
        workingSetPct={workingSetPct}
        workingSetTooltip={t(m.memoryWorkingSetTooltip)}
      />

      {!isUma && memory.system_ram_total_bytes > 0 ? (
        <HostSystemRamBar language={language} memory={memory} />
      ) : null}
    </section>
  );
}

function MemoryAllocationBar({
  language,
  onSelect,
  primaryTotal,
  segments,
  selectedSegment,
  workingSetPct,
  workingSetTooltip,
}: {
  readonly language: Language;
  readonly onSelect: (id: string) => void;
  readonly primaryTotal: number;
  readonly segments: readonly MemorySegment[];
  readonly selectedSegment: MemorySegment;
  readonly workingSetPct: number | null;
  readonly workingSetTooltip: string;
}) {
  return (
    <>
      <div className="relative mt-3 flex h-5 w-full overflow-hidden rounded-lg border border-border bg-muted">
        {segments.map((segment) => {
          const pct =
            primaryTotal > 0 ? (segment.bytes / primaryTotal) * 100 : 0;
          if (pct <= 0.3) return null;
          const active = selectedSegment.id === segment.id;
          return (
            <button
              aria-label={`${segment.label}: ${formatGiB(segment.bytes, language)}`}
              className={cn(
                "h-full border-r border-card/80 transition-opacity duration-200 last:border-r-0 focus-visible:outline-none motion-reduce:transition-none",
                segment.hatch === "free" && "telemetry-hatch-free",
                segment.hatch === "compressed" && "telemetry-hatch-compressed",
                active
                  ? "opacity-100 brightness-105"
                  : "opacity-85 hover:opacity-100",
              )}
              key={segment.id}
              onClick={() => onSelect(segment.id)}
              onFocus={() => onSelect(segment.id)}
              onMouseEnter={() => onSelect(segment.id)}
              style={{
                width: `${pct}%`,
                backgroundColor:
                  segment.hatch === "free" ? "transparent" : segment.colorVar,
              }}
              title={`${segment.label}: ${formatGiB(segment.bytes, language)} (${pct.toFixed(1)}%)`}
              type="button"
            />
          );
        })}
        {workingSetPct != null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground"
            data-working-set-marker=""
            style={{ left: `${workingSetPct}%` }}
            title={workingSetTooltip}
          />
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {segments.map((segment) => (
            <button
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-colors motion-reduce:transition-none",
                selectedSegment.id === segment.id
                  ? "border-foreground/30 bg-muted text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:text-foreground",
              )}
              key={segment.id}
              onClick={() => onSelect(segment.id)}
              type="button"
            >
              <span
                aria-hidden
                className="size-2 rounded-xs border border-border/50"
                style={{ backgroundColor: segment.colorVar }}
              />
              <span>{segment.label}</span>
              <span className="font-mono text-foreground">
                {formatGiB(segment.bytes, language)}
              </span>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          <strong className="text-foreground">{selectedSegment.label}:</strong>{" "}
          {selectedSegment.note}
        </span>
      </div>
    </>
  );
}

function HostSystemRamBar({
  language,
  memory,
}: {
  readonly language: Language;
  readonly memory: SystemTelemetryMemory;
}) {
  const { t } = useTranslation();
  const hostRamUsedPct =
    memory.system_ram_total_bytes > 0
      ? clampPct(
          (memory.system_ram_used_bytes / memory.system_ram_total_bytes) * 100,
        )
      : 0;

  return (
    <div
      className="mt-4 border-t border-border/80 pt-3"
      data-discrete-host-ram=""
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {t(m.hostSystemRamTitle)}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {t(m.memoryUsedOfTotal, {
            total: formatGiB(memory.system_ram_total_bytes, language),
            used: formatGiB(memory.system_ram_used_bytes, language),
          })}{" "}
          ·{" "}
          {t(m.memorySystemRamFree, {
            free: formatGiB(memory.system_ram_available_bytes, language),
          })}
        </span>
      </div>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="h-full"
          style={{
            width: `${hostRamUsedPct}%`,
            backgroundColor: "var(--telemetry-apps)",
          }}
        />
      </div>
    </div>
  );
}
