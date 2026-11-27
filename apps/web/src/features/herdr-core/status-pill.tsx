import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { herdrCoreMessages as m } from "./herdr-core.messages";
import { terminalStatusWord } from "./tree";
import type { HerdrCoreTerminal } from "./types";

interface StatusPillProps {
  readonly terminal: HerdrCoreTerminal;
  readonly compact?: boolean;
}

export function HerdrCoreStatusPill({
  terminal,
  compact = false,
}: StatusPillProps) {
  const t = useT();
  const isLive = terminal.state === "live";
  const word = isLive ? terminalStatusWord(terminal) : "finished";
  const msg = isLive ? terminal.status?.msg?.trim() : terminal.reason?.trim();
  const rawProgress = isLive ? terminal.status?.progress : null;
  const progress =
    typeof rawProgress === "number" && Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, Math.round(rawProgress)))
      : null;

  const presentation = resolvePresentation(word, isLive, t);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none",
            presentation.badgeClass,
          )}
          data-herdr-status={word ?? (isLive ? "live" : "finished")}
        >
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", presentation.dotClass)}
          />
          <span>{presentation.label}</span>
          {progress !== null ? (
            <span className="tabular-nums opacity-80">{progress}%</span>
          ) : null}
        </span>
        {!compact && msg ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {msg}
          </span>
        ) : null}
      </div>
      {!compact && word === "working" && progress !== null ? (
        <div
          aria-label={`${progress}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="h-1 w-full overflow-hidden rounded-full bg-[var(--app-progress-track)]"
          role="progressbar"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-[var(--app-progress-fill)] transition-transform duration-200 motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function resolvePresentation(
  word: string | null | undefined,
  isLive: boolean,
  t: ReturnType<typeof useT>,
): {
  readonly label: string;
  readonly badgeClass: string;
  readonly dotClass: string;
} {
  if (!isLive) {
    return {
      label: t(m.statusFinished),
      badgeClass:
        "border-[var(--app-status-neutral-border)] bg-[var(--app-status-neutral-surface)] text-[var(--app-status-neutral-text)]",
      dotClass: "bg-muted-foreground/60",
    };
  }
  switch (word) {
    case "blocked":
      return {
        label: t(m.statusBlocked),
        badgeClass:
          "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] text-[var(--app-status-warning-text)]",
        dotClass: "bg-[var(--app-status-warning-text)] animate-pulse",
      };
    case "working":
      return {
        label: t(m.statusWorking),
        badgeClass:
          "border-[var(--app-card-info-border)] bg-[var(--app-card-info-surface)] text-[var(--app-card-info-text)]",
        dotClass: "bg-[var(--app-card-info-text)] animate-pulse",
      };
    case "done":
      return {
        label: t(m.statusDone),
        badgeClass:
          "border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] text-[var(--app-status-success-text)]",
        dotClass: "bg-[var(--app-status-success-text)]",
      };
    case "error":
      return {
        label: t(m.statusError),
        badgeClass:
          "border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] text-[var(--app-status-danger-text)]",
        dotClass: "bg-[var(--app-status-danger-text)]",
      };
    case "idle":
      return {
        label: t(m.statusIdle),
        badgeClass:
          "border-[var(--app-status-neutral-border)] bg-[var(--app-status-neutral-surface)] text-[var(--app-status-neutral-text)]",
        dotClass: "bg-muted-foreground",
      };
    default:
      return {
        label: t(m.statusLive),
        badgeClass:
          "border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] text-[var(--app-status-success-text)]",
        dotClass: "bg-[var(--app-status-success-text)]",
      };
  }
}
