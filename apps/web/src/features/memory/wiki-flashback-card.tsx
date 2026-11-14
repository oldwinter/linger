import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { dayKey } from "@/lib/date-format";

import { formatReportDay, plain } from "../wiki/wiki-daily-card";
import { flashbackReport } from "./wiki-flashback";

/** The first two lines the report reads as prose: headings label sections, and
 * the card already shows the report's date. */
function previewLines(entry: TeamHubMemoryEntry): string[] {
  const lines = entry.content
    .replace(/^---\n[\s\S]*?\n---\n/u, "")
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line))
    .map((line) => plain(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "")))
    .filter(Boolean)
    .slice(0, 2);
  if (lines.length) return lines;
  const summary = plain(entry.summary);
  return summary ? [summary] : [];
}

export function WikiFlashbackCard({
  reports,
  onOpen,
}: {
  reports: readonly TeamHubMemoryEntry[] | undefined;
  onOpen: (day: string) => void;
}) {
  const flashback = flashbackReport(reports, dayKey(new Date()));
  if (!flashback) return null;
  const { day, entry, label } = flashback;
  return (
    <div className="flex shrink-0 px-4 pt-3">
      <button
        aria-label={`Open the Daily report from ${label.toLowerCase()} (${formatReportDay(day)})`}
        className="flex max-w-full flex-col items-start gap-1 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-left hover:bg-app-sidebar"
        onClick={() => onOpen(day)}
        type="button"
      >
        <span className="text-xs text-app-muted">
          {label} · <time dateTime={day}>{formatReportDay(day)}</time>
        </span>
        {previewLines(entry).map((line) => (
          <span
            key={line}
            className="line-clamp-1 max-w-full text-sm text-foreground"
          >
            {line}
          </span>
        ))}
      </button>
    </div>
  );
}
