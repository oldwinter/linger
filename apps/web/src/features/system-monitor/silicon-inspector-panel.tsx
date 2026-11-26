import {
  AiChipIcon,
  Alert02Icon,
  CpuIcon,
  FlashIcon,
  HardDriveIcon,
  ServerStack01Icon,
  ThermometerIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import {
  AnimatePresence,
  m as motionElem,
  useReducedMotion,
} from "motion/react";

import { Icon } from "@/components/ui/icon";
import type { Language, Translate } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import {
  clampPct,
  formatDurationCompact,
  formatGiB,
  formatInteger,
} from "./system-monitor-format";
import { systemMonitorMessages as m } from "./system-monitor.messages";
import type {
  SystemTelemetryHardware,
  SystemTelemetryInference,
  SystemTelemetryThermal,
} from "./system-monitor-queries";

function thresholdBarColor(
  pct: number,
  dangerAt = 90,
  warnAt = 75,
  inverted = false,
): string {
  if (inverted) {
    if (pct <= 100 - dangerAt) return "var(--telemetry-bad)";
    if (pct <= 100 - warnAt) return "var(--telemetry-warn)";
    return "var(--telemetry-ok)";
  }
  if (pct >= dangerAt) return "var(--telemetry-bad)";
  if (pct >= warnAt) return "var(--telemetry-warn)";
  return "var(--telemetry-ok)";
}

interface MeterSpec {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly pct: number | null;
  readonly warnAt: number;
  readonly dangerAt: number;
  readonly inverted?: boolean;
}

function thermalStateTone(state: SystemTelemetryThermal["state"]): string {
  switch (state) {
    case "nominal":
      return "bg-app-success/15 text-app-success";
    case "fair":
      return "bg-app-warning/15 text-app-warning";
    case "serious":
    case "critical":
      return "bg-app-danger/15 text-app-danger";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function buildMeters(
  hardware: SystemTelemetryHardware,
  language: Language,
  t: Translate,
): MeterSpec[] {
  const gpuLabel =
    hardware.gpu.freq_mhz != null
      ? t(m.meterGpuLoadFreq, {
          mhz: formatInteger(hardware.gpu.freq_mhz, language),
        })
      : hardware.gpu_core_count != null && hardware.gpu_core_count > 0
        ? t(m.meterGpuLoadCores, {
            cores: formatInteger(hardware.gpu_core_count, language),
          })
        : t(m.meterGpuLoad);

  const cpuLabel =
    hardware.cpu.total_cores > 0
      ? t(m.meterCpuLoad, {
          cores: formatInteger(hardware.cpu.total_cores, language),
        })
      : t(m.meterCpuLoadSimple);

  const packagePowerValue =
    hardware.power.package_w != null
      ? hardware.power.limit_w != null && hardware.power.limit_w > 0
        ? `${hardware.power.package_w.toFixed(1)} / ${Math.round(hardware.power.limit_w)} W`
        : `${hardware.power.package_w.toFixed(1)} W`
      : t(m.sensorUnavailable);

  const packagePowerPct =
    hardware.power.package_w != null &&
    hardware.power.limit_w != null &&
    hardware.power.limit_w > 0
      ? clampPct((hardware.power.package_w / hardware.power.limit_w) * 100)
      : null;

  const activeTempC =
    hardware.thermal.gpu_temp_c ?? hardware.thermal.soc_temp_c ?? null;
  const throttleCapC = hardware.thermal.throttle_temp_c ?? 100;

  const thermalMeter: MeterSpec =
    activeTempC != null
      ? {
          id: "thermal",
          label: t(m.meterThermal),
          value:
            hardware.thermal.throttle_temp_c != null
              ? `${Math.round(activeTempC)}°C / ${Math.round(hardware.thermal.throttle_temp_c)}°C`
              : `${Math.round(activeTempC)}°C`,
          pct: clampPct((activeTempC / Math.max(1, throttleCapC)) * 100),
          warnAt: 82,
          dangerAt: 95,
        }
      : hardware.thermal.cpu_speed_limit_pct != null
        ? {
            id: "thermal",
            label: t(m.meterThermalSpeedLimit),
            value: `${Math.round(hardware.thermal.cpu_speed_limit_pct)}%`,
            pct: clampPct(hardware.thermal.cpu_speed_limit_pct),
            warnAt: 15,
            dangerAt: 35,
            inverted: true,
          }
        : {
            id: "thermal",
            label: t(m.meterThermal),
            value: t(m.sensorUnavailable),
            pct: null,
            warnAt: 82,
            dangerAt: 95,
          };

  return [
    {
      id: "gpu",
      label: gpuLabel,
      value:
        hardware.gpu.util_pct != null
          ? `${Math.round(hardware.gpu.util_pct)}%`
          : t(m.sensorUnavailable),
      pct:
        hardware.gpu.util_pct != null ? clampPct(hardware.gpu.util_pct) : null,
      warnAt: 85,
      dangerAt: 97,
    },
    {
      id: "cpu",
      label: cpuLabel,
      value:
        hardware.cpu.load_pct != null
          ? `${Math.round(hardware.cpu.load_pct)}%`
          : t(m.sensorUnavailable),
      pct:
        hardware.cpu.load_pct != null ? clampPct(hardware.cpu.load_pct) : null,
      warnAt: 70,
      dangerAt: 90,
    },
    {
      id: "power",
      label: t(m.meterPackagePower),
      value: packagePowerValue,
      pct: packagePowerPct,
      warnAt: 80,
      dangerAt: 94,
    },
    thermalMeter,
  ];
}

export function SiliconInspectorPanel({
  hardware,
  inference,
  verbose,
}: {
  readonly hardware: SystemTelemetryHardware;
  readonly inference: SystemTelemetryInference;
  readonly verbose: boolean;
}) {
  const { language, t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const meters = buildMeters(hardware, language, t);

  const thermalLabel =
    hardware.thermal.state === "nominal"
      ? t(m.thermalNominal)
      : hardware.thermal.state === "fair"
        ? t(m.thermalFair)
        : hardware.thermal.state === "serious"
          ? t(m.thermalSerious)
          : hardware.thermal.state === "critical"
            ? t(m.thermalCritical)
            : t(m.thermalUnknown);

  return (
    <section
      aria-label={t(m.inspectorRegion)}
      className="space-y-3 rounded-xl border border-border bg-card p-4 lg:col-span-5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Icon icon={CpuIcon} size={15} />
            {t(m.inspectorTitle)}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {hardware.chip_name} · {hardware.os_label}
          </p>
        </div>
        {hardware.thermal.throttling ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-app-danger/15 px-2 py-0.5 text-[11px] font-semibold text-app-danger">
            <Icon icon={Alert02Icon} size={12} />
            {t(m.thermalThrottled)}
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              thermalStateTone(hardware.thermal.state),
            )}
          >
            {thermalLabel}
          </span>
        )}
      </div>

      <ThresholdMetersCard meters={meters} />

      <AnimatePresence initial={false}>
        {verbose ? (
          <motionElem.div
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
            data-verbose-inspector=""
            exit={{ opacity: 0, y: -3 }}
            initial={
              reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -3 }
            }
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
          >
            <VerboseHardwareDetails
              hardware={hardware}
              inference={inference}
              language={language}
            />
          </motionElem.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ThresholdMetersCard({
  meters,
}: {
  readonly meters: readonly MeterSpec[];
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-background/60 p-3 text-xs tabular-nums">
      {meters.map((meter) => (
        <div key={meter.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{meter.label}</span>
            <span
              className={cn(
                "font-mono font-medium",
                meter.pct == null ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {meter.value}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            {meter.pct != null ? (
              <div
                className="h-full rounded-full transition-colors duration-200 motion-reduce:transition-none"
                style={{
                  width: `${clampPct(meter.pct)}%`,
                  backgroundColor: thresholdBarColor(
                    meter.pct,
                    meter.dangerAt,
                    meter.warnAt,
                    meter.inverted,
                  ),
                }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function VerboseHardwareDetails({
  hardware,
  inference,
  language,
}: {
  readonly hardware: SystemTelemetryHardware;
  readonly inference: SystemTelemetryInference;
  readonly language: Language;
}) {
  const { t } = useTranslation();

  const powerParts: string[] = [];
  if (hardware.power.gpu_w != null) {
    powerParts.push(`GPU ${hardware.power.gpu_w.toFixed(1)}W`);
  }
  if (hardware.power.cpu_w != null) {
    powerParts.push(`CPU ${hardware.power.cpu_w.toFixed(1)}W`);
  }
  if (hardware.power.ane_w != null) {
    powerParts.push(`ANE ${hardware.power.ane_w.toFixed(1)}W`);
  }

  const gpuDetailParts: string[] = [];
  if (hardware.gpu.renderer_pct != null && hardware.gpu.tiler_pct != null) {
    gpuDetailParts.push(
      t(m.gpuRendererTiler, {
        renderer: Math.round(hardware.gpu.renderer_pct),
        tiler: Math.round(hardware.gpu.tiler_pct),
      }),
    );
  }
  if (hardware.gpu.ane_util_pct != null) {
    gpuDetailParts.push(
      t(m.aneUtilNote, { pct: Math.round(hardware.gpu.ane_util_pct) }),
    );
  } else if (hardware.ane_cores != null && hardware.ane_cores > 0) {
    gpuDetailParts.push(t(m.aneCoresNote, { cores: hardware.ane_cores }));
  }

  const diskParts: string[] = [];
  if (hardware.disk.free_bytes != null) {
    diskParts.push(
      t(m.diskFreeSummary, {
        free: formatGiB(hardware.disk.free_bytes, language),
      }),
    );
  }
  if (hardware.disk.model_cache_bytes != null) {
    diskParts.push(
      t(m.diskModelCacheSummary, {
        cache: formatGiB(hardware.disk.model_cache_bytes, language),
      }),
    );
  }

  const coolingSummary =
    hardware.thermal.fan_rpm != null
      ? hardware.thermal.fan_max_rpm != null
        ? t(m.coolingFanRpm, {
            max: formatInteger(hardware.thermal.fan_max_rpm, language),
            rpm: formatInteger(hardware.thermal.fan_rpm, language),
          })
        : t(m.coolingFanRpmOnly, {
            rpm: formatInteger(hardware.thermal.fan_rpm, language),
          })
      : hardware.thermal.fan_pct != null
        ? t(m.coolingFanPct, { pct: Math.round(hardware.thermal.fan_pct) })
        : t(m.coolingPassive);

  return (
    <>
      {hardware.cpu.clusters.length > 0 ? (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">
              {t(m.cpuClustersTitle)}
            </span>
            {hardware.cpu.load_avg && hardware.cpu.load_avg.length === 3 ? (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {t(m.cpuLoadAvg, {
                  values: hardware.cpu.load_avg
                    .map((value) => value.toFixed(2))
                    .join(" · "),
                })}
              </span>
            ) : null}
          </div>
          <div className="space-y-1.5">
            {hardware.cpu.clusters.map((cluster) => (
              <div
                className="grid grid-cols-[1fr_4.5rem_3rem] items-center gap-2 text-[11px] tabular-nums"
                key={cluster.id}
              >
                <span className="truncate text-muted-foreground">
                  {t(m.cpuClusterCores, {
                    cores: cluster.cores,
                    name: cluster.name,
                  })}
                </span>
                <span className="font-mono text-right text-muted-foreground">
                  {cluster.freq_ghz != null
                    ? `${cluster.freq_ghz.toFixed(2)} GHz`
                    : t(m.unavailableValue)}
                </span>
                <span className="font-mono text-right font-semibold text-foreground">
                  {cluster.load_pct != null
                    ? `${Math.round(cluster.load_pct)}%`
                    : t(m.unavailableValue)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
        <div className="rounded-lg border border-border bg-background/60 p-2.5">
          <div className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon icon={FlashIcon} size={12} />
            {t(m.powerDomainsTitle)}
          </div>
          <div
            className={cn(
              "mt-1 font-medium",
              powerParts.length > 0
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {powerParts.length > 0
              ? powerParts.join(" · ")
              : t(m.sensorUnavailableRootless)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2.5">
          <div className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon icon={ThermometerIcon} size={12} />
            {t(m.gpuDetailTitle)}
          </div>
          <div
            className={cn(
              "mt-1 font-medium",
              gpuDetailParts.length > 0
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {gpuDetailParts.length > 0
              ? gpuDetailParts.join(" · ")
              : t(m.sensorUnavailable)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2.5">
          <div className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon icon={HardDriveIcon} size={12} />
            {t(m.diskCacheTitle)}
          </div>
          <div
            className={cn(
              "mt-1 font-medium",
              diskParts.length > 0
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {diskParts.length > 0
              ? diskParts.join(" · ")
              : t(m.sensorUnavailable)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2.5">
          <div className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon icon={AiChipIcon} size={12} />
            {t(m.coolingTitle)}
          </div>
          <div
            className={cn(
              "mt-1 font-medium",
              hardware.thermal.fan_rpm != null ||
                hardware.thermal.fan_pct != null
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {coolingSummary}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon icon={ServerStack01Icon} size={13} />
          {t(m.loadedModelsTitle)}
        </div>
        {inference.loaded_models.length > 0 ? (
          <div className="space-y-1.5">
            {inference.loaded_models.map((model) => (
              <div
                className="flex items-center justify-between gap-2 text-[11px] tabular-nums"
                key={model.id}
              >
                <div className="min-w-0 truncate">
                  <span className="font-medium text-foreground">
                    {model.name}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({model.engine}
                    {model.quant ? ` · ${model.quant}` : ""})
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-muted-foreground">
                  <span>{formatGiB(model.vram_bytes, language)}</span>
                  {model.slots > 0 ? (
                    <span>
                      {t(m.modelSlotsSummary, {
                        active: model.active_slots,
                        total: model.slots,
                      })}
                    </span>
                  ) : null}
                  {model.keep_alive_remaining_sec != null ? (
                    <span className="inline-flex items-center gap-0.5 text-foreground">
                      <Icon icon={Timer01Icon} size={11} />
                      {formatDurationCompact(model.keep_alive_remaining_sec)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t(m.noLoadedModels)}
          </p>
        )}
      </div>
    </>
  );
}
