import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { plain } from "@/features/wiki/wiki-daily-card";

import { reportDate } from "./wiki-period-reports";

export interface ReportSearchItem {
  entry: TeamHubMemoryEntry;
  day: string;
  /** The report's readable text, prepared once per report list. */
  text: string;
}

/** What every keystroke searches: each report's date and readable text. */
export function reportSearchItems(
  reports: readonly TeamHubMemoryEntry[],
): ReportSearchItem[] {
  return reports.flatMap((entry) => {
    const day = reportDate(entry);
    return day ? [{ day, entry, text: readableText(entry) }] : [];
  });
}

/**
 * The reports whose date or readable text holds every word of the query,
 * case-insensitively. An empty query keeps the whole list.
 */
export function searchReports(
  items: readonly ReportSearchItem[],
  query: string,
): ReportSearchItem[] {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter(({ day, text }) => {
    const haystack = `${day} ${text}`;
    return words.every((word) => haystack.includes(word));
  });
}

function readableText(entry: TeamHubMemoryEntry): string {
  // Frontmatter is metadata and heading and list markers are structure; the
  // words that remain are what a reader sees.
  const body = entry.content
    .replace(/^---\n[\s\S]*?\n---\n/u, "")
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s+/gmu, "");
  return plain(`${body}\n${entry.summary}`).toLowerCase();
}
