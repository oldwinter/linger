import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { reportDate } from "./wiki-period-reports";

export interface WikiFlashback {
  label: "One month ago" | "One year ago";
  /** The chosen report's calendar day. */
  day: string;
  entry: TeamHubMemoryEntry;
}

/**
 * The Daily report for the same day one month earlier, else the same day one
 * year earlier. A month end clamps to the shorter month's last day, so the
 * 31st still finds a February report instead of skipping a month.
 */
export function flashbackReport(
  reports: readonly TeamHubMemoryEntry[] | undefined,
  reference: string,
): WikiFlashback | undefined {
  if (!reports) return;
  const byDay = new Map<string, TeamHubMemoryEntry>();
  for (const entry of reports) {
    const day = reportDate(entry);
    if (day && !byDay.has(day)) byDay.set(day, entry);
  }
  const monthDay = earlierDay(reference, 1);
  const monthEntry = byDay.get(monthDay);
  if (monthEntry)
    return { day: monthDay, entry: monthEntry, label: "One month ago" };
  const yearDay = earlierDay(reference, 12);
  const yearEntry = byDay.get(yearDay);
  if (yearEntry)
    return { day: yearDay, entry: yearEntry, label: "One year ago" };
  return undefined;
}

function earlierDay(reference: string, months: number): string {
  const [year = 0, month = 1, day = 1] = reference.split("-").map(Number);
  const monthIndex = month - 1 - months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return `${pad(targetYear, 4)}-${pad(targetMonth + 1, 2)}-${pad(Math.min(day, lastDay), 2)}`;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
